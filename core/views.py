from django.shortcuts import render, redirect
from django.contrib.auth.views import LoginView
from django.urls import reverse_lazy
from django.contrib.auth import logout, update_session_auth_hash
from .forms import LoginForm, RegistrationForm
from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
from .utils import create_audit_log
import json
from django.http import JsonResponse
from django.core.paginator import Paginator, EmptyPage, PageNotAnInteger
from .models import Incident, Notification, AuditLog
from django.utils import timezone
from django.db.models import Q, Avg, Count, F, ExpressionWrapper, DurationField
from django.views.decorators.http import require_http_methods
from django.contrib import messages
from datetime import timedelta
from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
import os
import re
import urllib.request
from collections import defaultdict
from functools import wraps
from django.conf import settings as django_settings
from .ml.predictor import classify_incident


GEMINI_SYSTEM_PROMPT = (
    "You are Sentinel Assistant, a campus emergency-reporting helper for the "
    "Sentinel school emergency response platform. Answer concisely (2-4 sentences). "
    "If the user describes a possible emergency, acknowledge it, ask for the exact "
    "location and key details, and remind them to follow school emergency procedures. "
    "Do not claim to file reports yourself; the user files them via the Incident "
    "Report page. Never invent incident IDs or locations."
)


def _gemini_reply(message):
    """Ask Gemini for a chat reply. Returns text or None on any failure.

    Uses only the standard library (no new dependencies). The API key comes
    from the GEMINI_API_KEY environment variable via settings — never from
    client input or hardcoded source.
    """
    api_key = getattr(django_settings, "GEMINI_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return None
    model = getattr(django_settings, "GEMINI_MODEL", "gemini-flash-lite-latest") or "gemini-flash-lite-latest"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = json.dumps({
        "contents": [{
            "parts": [{"text": GEMINI_SYSTEM_PROMPT + "\n\nUser: " + message[:2000]}],
        }],
        "generationConfig": {"maxOutputTokens": 300, "temperature": 0.4},
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "X-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except Exception:
        return None
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except (KeyError, IndexError, TypeError, AttributeError):
        return None

User = get_user_model()

def _check_role(request, allowed_roles, response_type="json"):
    if request.user.role not in allowed_roles:
        if response_type == "redirect":
            return redirect("dashboard")
        return JsonResponse({"error": "Forbidden"}, status=403)
    return None


# Decorator to require admin role on views. Returns JSON 403 for API calls
# and redirects to dashboard for normal page requests when appropriate.
def admin_required(response_type="json"):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            if not getattr(request, "user", None) or not request.user.is_authenticated or request.user.role != "admin":
                if response_type == "redirect":
                    return redirect("report")
                return JsonResponse({"error": "Unauthorized"}, status=403)
            return view_func(request, *args, **kwargs)
        return _wrapped
    return decorator


def format_duration(seconds: int) -> str:
    """Format duration in seconds to human-readable string (e.g., '2d 18h', '1h 6m', '45s')."""
    if not seconds or seconds < 0:
        return "0s"
    if seconds < 60:
        return f"{seconds}s"
    
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    
    hours = minutes // 60
    if hours < 24:
        remaining_minutes = minutes % 60
        return f"{hours}h {remaining_minutes}m" if remaining_minutes else f"{hours}h"
    
    days = hours // 24
    if days < 7:
        remaining_hours = hours % 24
        return f"{days}d {remaining_hours}h" if remaining_hours else f"{days}d"
    
    weeks = days // 7
    remaining_days = days % 7
    return f"{weeks}w {remaining_days}d" if remaining_days else f"{weeks}w"


def landing_page(request):
    if request.user.is_authenticated and request.user.role == "admin":
        return redirect("dashboard")
    elif request.user.is_authenticated and request.user.role == "reporter":
        return redirect("report")
    return render(request, "index.html")

class UserLoginView(LoginView):
    template_name = "login.html"
    authentication_form = LoginForm

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            if request.user.role == "admin":
                return redirect("dashboard")
            elif request.user.role == "reporter":
                return redirect("report")
        return super().dispatch(request, *args, **kwargs)

    def form_valid(self, form):
        user = form.get_user()
        messages.success(self.request, f"Welcome back {user.username}!")
        # Audit once here (get_success_url may be called multiple times).
        create_audit_log(
            request=self.request,
            action="login",
            model_name="User",
            object_id=str(user.id),
            changes={
                "role": user.role
            }
        )
        return super().form_valid(form)

    def get_success_url(self):
        user = self.request.user
        # Admin / Command Center
        if user.role == "admin":
            return reverse_lazy("dashboard")

        # Reporter
        elif user.role == "reporter":
            return reverse_lazy("report")

        # Fallback
        return reverse_lazy("landing")

def register(request):
    """Handle user registration with form validation."""
    if request.user.is_authenticated:
        if request.user.role == "admin":
            return redirect("dashboard")
        elif request.user.role == "reporter":
            return redirect("report")
    
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            # Set default role as reporter
            user.role = User.Role.REPORTER
            user.save()
            
            # Create audit log
            create_audit_log(
                request=request,
                action="create",
                model_name="User",
                object_id=str(user.id),
                changes={
                    "username": user.username,
                    "email": user.email,
                    "role": user.role
                }
            )
            
            # Return redirect URL for both normal and AJAX requests
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({"success": True, "redirect": "/login/"})
            messages.success(request, "Account created successfully. Please log in.")
            return redirect("login")
        else:
            # Prepare error messages
            errors = {}
            for field, field_errors in form.errors.items():
                errors[field] = field_errors[0] if field_errors else "Error"
            
            # Return JSON for AJAX requests
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({"success": False, "errors": errors}, status=400)
            
            return render(request, "register.html", {
                "form": form,
                "errors": errors,
            })
    else:
        form = RegistrationForm()
    
    return render(request, "register.html", {"form": form})

@login_required(login_url="login")
@require_http_methods(["POST"])
def logout_view(request):
    username = request.user.username if request.user.is_authenticated else ""
    user_id = str(request.user.id) if request.user.is_authenticated else ""
    logout(request)
    if user_id:
        create_audit_log(
            request=request,
            action="logout",
            model_name="User",
            object_id=user_id,
            changes={"username": username},
        )
    messages.success(request, "You have been logged out successfully.")
    return redirect("login")

@login_required(login_url="login")
@admin_required(response_type="redirect")
def dashboard(request):
    if request.user.role != "admin":
        return redirect("report")

    active_incidents = Incident.objects.filter(status=Incident.Status.ACTIVE)
    active_incidents_count = active_incidents.count()

    resolved_today_count = Incident.objects.filter(
        status=Incident.Status.RESOLVED,
        resolved_at__date=timezone.now().date()
    ).count()

    response_window = timezone.now() - timedelta(days=7)
    avg_response_duration = Incident.objects.filter(
        resolved_at__isnull=False,
        resolved_at__gte=response_window
    ).annotate(
        response_time=ExpressionWrapper(
            F('resolved_at') - F('created_at'),
            output_field=DurationField()
        )
    ).aggregate(avg=Avg('response_time'))['avg']

    avg_response_seconds = int(avg_response_duration.total_seconds()) if avg_response_duration else 0
    avg_response_minutes = avg_response_seconds // 60
    avg_response_display = format_duration(avg_response_seconds)
    avg_response_percent = min(avg_response_minutes, 100)
    resolved_today_percent = min(resolved_today_count, 100)

    def format_location(raw_location):
        if not raw_location:
            return ''
        cleaned = raw_location.replace('_', ' ').replace('-', ' ').strip()
        return ' '.join(cleaned.split()).title()

    incident_objects = Incident.objects.exclude(status=Incident.Status.RESOLVED).order_by('-created_at')[:7]
    incident_feed = []
    for inc in incident_objects:
        display_location = format_location(inc.location or inc.specific_location or '')
        incident_feed.append({
            'id': str(inc.id),
            'category': inc.category,
            'location': inc.location or '',
            'location_display': display_location,
            'specific_location': inc.specific_location or '',
            'description': inc.description or '',
            'status': inc.status,
            'display_status': inc.get_status_display(),
            'created_at': inc.created_at,
        })

    incident_counts = {
        'all': len(incident_feed),
        'fire': sum(1 for inc in incident_feed if inc['category'] == Incident.Category.FIRE),
        'med': sum(1 for inc in incident_feed if inc['category'] == Incident.Category.MEDICAL),
        'sec': sum(1 for inc in incident_feed if inc['category'] == Incident.Category.SECURITY),
        'accident': sum(1 for inc in incident_feed if inc['category'] == Incident.Category.ACCIDENT),
    }

    dashboard_active_incidents = []
    for inc in active_incidents:
        display_location = format_location(inc.location or inc.specific_location or '')
        dashboard_active_incidents.append({
            'id': str(inc.id),
            'category': inc.category,
            'location': inc.location or inc.specific_location or 'Unknown location',
            'location_display': display_location,
            'specific_location': inc.specific_location or '',
            'description': inc.description or '',
            'status': inc.status,
            'display_status': inc.get_status_display(),
        })

    return render(request, "dashboard.html", {
        "active_incidents_count": active_incidents_count,
        "sidebar_incidents_badge": active_incidents_count,
        "resolved_today_count": resolved_today_count,
        "avg_response_minutes": avg_response_minutes,
        "avg_response_display": avg_response_display,
        "avg_response_percent": avg_response_percent,
        "resolved_today_percent": resolved_today_percent,
        "incident_feed": incident_feed,
        "incident_counts": incident_counts,
        "dashboard_active_incidents": dashboard_active_incidents,
    })

@login_required(login_url="login")
@admin_required(response_type="json")
@require_http_methods(["GET"])
def dashboard_stats_api(request):
    """Return current dashboard KPI stats as JSON for live updates."""
    if request.user.role != "admin":
        return JsonResponse({"error": "Unauthorized"}, status=403)
    
    active_incidents_count = Incident.objects.filter(status=Incident.Status.ACTIVE).count()
    
    resolved_today_count = Incident.objects.filter(
        status=Incident.Status.RESOLVED,
        resolved_at__date=timezone.now().date()
    ).count()
    
    response_window = timezone.now() - timedelta(days=7)
    avg_response_duration = Incident.objects.filter(
        resolved_at__isnull=False,
        resolved_at__gte=response_window
    ).annotate(
        response_time=ExpressionWrapper(
            F('resolved_at') - F('created_at'),
            output_field=DurationField()
        )
    ).aggregate(avg=Avg('response_time'))['avg']
    
    avg_response_seconds = int(avg_response_duration.total_seconds()) if avg_response_duration else 0
    avg_response_minutes = avg_response_seconds // 60
    avg_response_display = format_duration(avg_response_seconds)
    
    return JsonResponse({
        "active_incidents_count": active_incidents_count,
        "resolved_today_count": resolved_today_count,
        "avg_response_minutes": avg_response_minutes,
        "avg_response_display": avg_response_display,
    })

@login_required(login_url="login")
@admin_required(response_type="redirect")
def livemap(request):
    if request.user.role != "admin":
        return redirect("dashboard")

    active_incidents = Incident.objects.filter(status=Incident.Status.ACTIVE)
    active_incidents_count = active_incidents.count()

    def format_location(raw_location):
        if not raw_location:
            return ''
        cleaned = raw_location.replace('_', ' ').replace('-', ' ').strip()
        return ' '.join(cleaned.split()).title()

    dashboard_active_incidents = []
    for inc in active_incidents:
        display_location = format_location(inc.location or inc.specific_location or '')
        dashboard_active_incidents.append({
            'id': str(inc.id),
            'category': inc.category,
            'location': inc.location or inc.specific_location or 'Unknown location',
            'location_display': display_location,
            'specific_location': inc.specific_location or '',
            'description': inc.description or '',
            'status': inc.status,
            'display_status': inc.get_status_display(),
        })

    return render(request, "livemap.html", {
        "active_incidents_count": active_incidents_count,
        "sidebar_incidents_badge": active_incidents_count,
        "dashboard_active_incidents": dashboard_active_incidents,
    })

@login_required(login_url="login")
@admin_required(response_type="json")
@require_http_methods(["GET"])
def activity_chart_api(request):
    """Return incident activity data grouped by range and category."""
    if request.user.role != "admin":
        return JsonResponse({"error": "Unauthorized"}, status=403)

    requested_range = request.GET.get('range', '24')
    try:
        requested_range = int(requested_range)
    except (TypeError, ValueError):
        requested_range = 24

    if requested_range not in (24, 7, 30):
        requested_range = 24

    now = timezone.localtime(timezone.now())

    categories = {
        Incident.Category.FIRE: 'fire',
        Incident.Category.MEDICAL: 'med',
        Incident.Category.SECURITY: 'sec',
        Incident.Category.ACCIDENT: 'accident',
    }

    data = []
    if requested_range == 24:
        start = now - timedelta(hours=24)
        incidents = Incident.objects.filter(created_at__gte=start)

        for hour in range(24):
            data.append({
                'label': str(hour) + 'h',
                'hour': hour,
                'fire': 0,
                'med': 0,
                'sec': 0,
                'accident': 0,
            })

        for inc in incidents:
            local_created = timezone.localtime(inc.created_at)
            bucket = local_created.hour
            key = categories.get(inc.category, 'accident')
            data[bucket][key] += 1

    else:
        start_date = (now - timedelta(days=requested_range - 1)).date()
        incidents = Incident.objects.filter(created_at__date__gte=start_date)

        for day_offset in range(requested_range):
            day = start_date + timedelta(days=day_offset)
            data.append({
                'label': day.strftime('%a'),
                'date': day.isoformat(),
                'fire': 0,
                'med': 0,
                'sec': 0,
                'accident': 0,
            })

        for inc in incidents:
            local_created = timezone.localtime(inc.created_at)
            day_index = (local_created.date() - start_date).days
            if 0 <= day_index < requested_range:
                key = categories.get(inc.category, 'accident')
                data[day_index][key] += 1

    return JsonResponse(data, safe=False)

@login_required(login_url="login")
@require_http_methods(["POST"])
def chatbot_api(request):
    """Local Sentinel chatbot with ML-assisted emergency classification.

    This endpoint does not automatically create an incident. It provides
    guidance and, when the message looks like an incident description,
    returns the existing TF-IDF + Logistic Regression prediction as
    decision support.
    """
    if request.user.role not in ["admin", "reporter"]:
        return JsonResponse({"success": False, "error": "Unauthorized"}, status=403)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    message = (payload.get("message") or "").strip()
    if not message:
        return JsonResponse({"success": False, "error": "Message is required."}, status=400)

    text = message.lower()
    greetings = {"hi", "hello", "hey", "good morning", "good afternoon", "good evening"}
    help_terms = ["help", "what can you do", "how does this work", "how can you help"]
    report_terms = ["report", "file a report", "submit a report", "incident report"]
    emergency_terms = [
        "fire", "smoke", "burning", "flame", "fainted", "unconscious", "bleeding",
        "injured", "injury", "hurt", "collapsed", "seizure", "stolen", "theft",
        "robbery", "fight", "weapon", "threat", "accident", "explosion", "gas leak",
        "danger", "emergency", "harassment", "intruder", "violence"
    ]

    if text in greetings or any(text.startswith(g + " ") for g in greetings):
        reply = "Hello! I’m Sentinel Assistant. I can help explain the reporting process and analyze an emergency description."
        return JsonResponse({"success": True, "reply": reply, "prediction": None, "show_report": False})

    if any(term in text for term in help_terms):
        reply = (
            "I can help with incident reporting and emergency classification. "
            "Describe what happened, for example: ‘There is smoke coming from Room 204.’ "
            "I will show the ML classification as decision support."
        )
        return JsonResponse({"success": True, "reply": reply, "prediction": None, "show_report": False})

    if any(term in text for term in report_terms) and not any(term in text for term in emergency_terms):
        return JsonResponse({
            "success": True,
            "reply": "You can file an incident using the Incident Report page. Please provide the incident type, description, and location.",
            "prediction": None,
            "show_report": True,
        })

    looks_like_incident = any(term in text for term in emergency_terms) or len(text.split()) >= 8
    prediction = None
    if looks_like_incident:
        try:
            prediction = classify_incident(message)
        except Exception:
            prediction = None
        ai_reply = _gemini_reply(message)
        if ai_reply:
            if prediction:
                ai_reply += (
                    f" [ML decision support: {prediction['label']} "
                    f"({prediction['confidence_percent']:.2f}% confidence) — please verify "
                    "the type and location before submitting.]"
                )
            return JsonResponse({
                "success": True,
                "reply": ai_reply,
                "prediction": prediction,
                "show_report": True,
            })
        if prediction:
            reply = (
                f"Based on the description, the ML model classified this as "
                f"{prediction['label']} with {prediction['confidence_percent']:.2f}% confidence. "
                "This is decision support only; please verify the incident type and location before submitting the report."
            )
            return JsonResponse({
                "success": True,
                "reply": reply,
                "prediction": prediction,
                "show_report": True,
            })

    ai_reply = _gemini_reply(message)
    if ai_reply:
        return JsonResponse({"success": True, "reply": ai_reply, "prediction": None, "show_report": False})

    reply = (
        "I can help classify possible emergencies. Please describe what happened, "
        "where it happened, and any immediate danger. If this is an actual emergency, "
        "follow your school's emergency procedure and contact the appropriate emergency personnel."
    )
    return JsonResponse({"success": True, "reply": reply, "prediction": None, "show_report": False})

@login_required(login_url="login")
def report(request):
    active_incidents_count = Incident.objects.filter(status='active').count()
    return render(request, "report.html", {
        'sidebar_incidents_badge': active_incidents_count,
    })

@login_required(login_url="login")
@require_http_methods(["POST"])
def report_incident_api(request):
    if request.user.role not in ["admin", "reporter"]:
        return JsonResponse({"error": "Unauthorized"}, status=403)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    valid_categories = {c for c, _ in Incident.Category.choices}

    category = str(payload.get("category") or "").strip()
    description = str(payload.get("description") or "").strip()
    location = (
        str(payload.get("location") or "").strip()
        or str(payload.get("location_display") or "").strip()
    )
    specific_location = str(payload.get("specific_location") or "").strip()
    severity = str(payload.get("severity") or "").strip()

    # GPS LOCATION
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    location_accuracy = payload.get("location_accuracy")

    # Photo uploads are not supported by the backend.
    if payload.get("photos"):
        return JsonResponse(
            {"success": False, "error": "Photo uploads are not supported."},
            status=400,
        )

    errors = {}

    if not category:
        errors["category"] = "Incident type is required."
    elif category not in valid_categories:
        errors["category"] = "Invalid incident type."

    if not description:
        errors["description"] = "Description is required."
    elif len(description) > 2000:
        errors["description"] = "Description must be at most 2000 characters."

    if not location:
        errors["location"] = "Location is required."
    elif len(location) > 255:
        errors["location"] = "Location must be at most 255 characters."

    if len(specific_location) > 255:
        errors["specific_location"] = "Specific location must be at most 255 characters."

    if len(severity) > 50:
        errors["severity"] = "Severity must be at most 50 characters."

    # Validate GPS values when supplied, but keep GPS optional so reporting
    # still works on browsers/devices that deny location permission.
    try:
        if latitude not in (None, ""):
            latitude = float(latitude)
            if not -90 <= latitude <= 90:
                errors["latitude"] = "Invalid latitude."
        else:
            latitude = None

        if longitude not in (None, ""):
            longitude = float(longitude)
            if not -180 <= longitude <= 180:
                errors["longitude"] = "Invalid longitude."
        else:
            longitude = None

        if location_accuracy not in (None, ""):
            location_accuracy = float(location_accuracy)
            if location_accuracy < 0:
                errors["location_accuracy"] = "Invalid location accuracy."
        else:
            location_accuracy = None
    except (TypeError, ValueError):
        errors["location"] = "Invalid GPS location data."

    if errors:
        return JsonResponse({"success": False, "errors": errors}, status=400)

    # Machine-learning classification is decision support only.
    # The reporter's selected category remains the official incident category.
    try:
        ml_result = classify_incident(description)
    except Exception as ml_error:
        ml_result = {
            "category": None,
            "label": "Unavailable",
            "confidence": 0.0,
            "confidence_percent": 0.0,
            "error": str(ml_error),
            "alternatives": [],
        }

    note_parts = []

    if severity:
        note_parts.append("Severity: %s" % severity)

    if ml_result.get("category"):
        note_parts.append(
            "ML Classification: %s (%s)" % (
                ml_result["label"],
                ml_result["category"],
            )
        )
        note_parts.append(
            "ML Confidence: %.2f%%" % ml_result.get("confidence_percent", 0.0)
        )
        note_parts.append("Reporter Selected Type: %s" % category)
    else:
        note_parts.append("ML Classification: unavailable")

    operator_notes = "\n".join(note_parts) or None

    try:
        inc = Incident.objects.create(
            category=category,
            description=description,
            location=location,
            specific_location=specific_location,
            latitude=latitude,
            longitude=longitude,
            location_accuracy=location_accuracy,
            operator_notes=operator_notes,
            reported_by=request.user,
            status=Incident.Status.ACTIVE,
        )

        Notification.objects.create(incident=inc, user=None)

        create_audit_log(
            request=request,
            action="create",
            model_name="Incident",
            object_id=str(inc.id),
            changes={
                "type": category,
                "description": description,
                "location": location,
                "specific_location": specific_location,
                "latitude": latitude,
                "longitude": longitude,
                "location_accuracy": location_accuracy,
                "severity": severity,
                "ml_category": ml_result.get("category"),
                "ml_confidence": ml_result.get("confidence_percent"),
            },
        )
    except Exception:
        return JsonResponse(
            {"success": False, "error": "Unable to save the incident. Please try again."},
            status=500,
        )

    return JsonResponse({
        "success": True,
        "message": "Incident dispatched and logged successfully.",
        "id": str(inc.id),
        "incident": {
            "id": str(inc.id),
            "uuid": str(inc.id),
            "type": inc.category,
            "desc": inc.description,
            "location": inc.location,
            "specific_location": inc.specific_location,
            "latitude": float(inc.latitude) if inc.latitude is not None else None,
            "longitude": float(inc.longitude) if inc.longitude is not None else None,
            "location_accuracy": inc.location_accuracy,
            "ml_category": ml_result.get("category"),
            "ml_label": ml_result.get("label"),
            "ml_confidence": ml_result.get("confidence_percent"),
            "ml_available": bool(ml_result.get("category")),
        },
    })

@login_required(login_url="login")
@require_http_methods(["POST"])
def classify_incident_api(request):
    """Classify an incident description without creating an incident record."""
    if request.user.role not in ["admin", "reporter"]:
        return JsonResponse({"error": "Unauthorized"}, status=403)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "error": "Invalid JSON"}, status=400)

    description = (payload.get("description") or "").strip()
    if not description:
        return JsonResponse(
            {"success": False, "error": "Description is required."},
            status=400,
        )

    try:
        result = classify_incident(description)
        return JsonResponse({"success": True, "prediction": result})
    except Exception as e:
        return JsonResponse(
            {"success": False, "error": str(e)},
            status=503,
        )


@login_required(login_url="login")
@admin_required(response_type="redirect")
def incidents(request):
    # NOTE: table rows are rendered client-side from /api/incidents/ — only
    # aggregate counts are needed here (no full-table queryset).
    today = timezone.now().date()
    total_incidents = Incident.objects.count()
    active_count = Incident.objects.filter(status='active').count()
    dispatched_count = Incident.objects.filter(status='dispatched').count()
    onscene_count = Incident.objects.filter(status='onscene').count()
    investigating_count = Incident.objects.filter(status='investigating').count()
    resolved_today_count = Incident.objects.filter(
        status='resolved', resolved_at__date=today
    ).count()
    total_this_month = Incident.objects.filter(created_at__year=timezone.now().year, created_at__month=timezone.now().month).count()
    all_count = total_incidents
    fire_count = Incident.objects.filter(category='fire').count()
    med_count = Incident.objects.filter(category='med').count()
    sec_count = Incident.objects.filter(category='sec').count()
    acc_count = Incident.objects.filter(category='accident').count()
    return render(request, "incidents.html", {
        'total_incidents': total_incidents,
        'active_count': active_count,
        'dispatched_count': dispatched_count,
        'onscene_count': onscene_count,
        'investigating_count': investigating_count,
        'resolved_today_count': resolved_today_count,
        'total_this_month': total_this_month,
        'all_count': all_count,
        'fire_count': fire_count,
        'med_count': med_count,
        'sec_count': sec_count,
        'acc_count': acc_count,
        'sidebar_incidents_badge': active_count,
    })


@login_required(login_url="login")
@admin_required(response_type="json")
def incidents_api(request):
    valid_categories = {c for c, _ in Incident.Category.choices}
    valid_statuses = {s for s, _ in Incident.Status.choices}

    incidents_queryset = Incident.objects.all().order_by('-created_at')

    # ── Optional filters (work in both legacy + paginated modes) ──
    status = (request.GET.get("status") or "").strip().lower()
    if status and status != "all":
        if status not in valid_statuses:
            return JsonResponse({"success": False, "error": "Invalid status filter."}, status=400)
        incidents_queryset = incidents_queryset.filter(status=status)
    category = (request.GET.get("category") or "").strip().lower()
    if category and category != "all":
        if category not in valid_categories:
            return JsonResponse({"success": False, "error": "Invalid category filter."}, status=400)
        incidents_queryset = incidents_queryset.filter(category=category)
    search = (request.GET.get("search") or "").strip()
    if search:
        incidents_queryset = incidents_queryset.filter(
            Q(description__icontains=search) |
            Q(location__icontains=search) |
            Q(specific_location__icontains=search)
        )

    def _serialize(inc):
        return {
            'id': str(inc.id),
            'uuid': str(inc.id),
            'type': inc.category,
            'desc': inc.description or '',
            'status': inc.status,
            'location': inc.location or '',
            'specific_location': inc.specific_location or '',
            'latitude': float(inc.latitude) if inc.latitude is not None else None,
            'longitude': float(inc.longitude) if inc.longitude is not None else None,
            'location_accuracy': inc.location_accuracy,
            'time': inc.created_at.strftime('%H:%M'),
            'timeRaw': int(inc.created_at.timestamp() * 1000),
            'resolvedAtRaw': int(inc.resolved_at.timestamp() * 1000) if inc.resolved_at else None,
        }

    # ── Paginated mode (opt-in via ?page=/page_size=) ──
    if "page" in request.GET or "page_size" in request.GET:
        try:
            page = int(request.GET.get("page", 1))
            page_size = int(request.GET.get("page_size", 15))
        except (TypeError, ValueError):
            return JsonResponse({"success": False, "error": "Invalid pagination parameters."}, status=400)
        page = max(page, 1)
        page_size = min(max(page_size, 1), 100)
        paginator = Paginator(incidents_queryset, page_size)
        try:
            page_obj = paginator.page(page)
        except (EmptyPage, PageNotAnInteger):
            page_obj = paginator.page(paginator.num_pages or 1)
        return JsonResponse({
            "success": True,
            "results": [_serialize(inc) for inc in page_obj.object_list],
            "pagination": {
                "page": page_obj.number,
                "num_pages": paginator.num_pages,
                "total": paginator.count,
                "has_previous": page_obj.has_previous(),
                "has_next": page_obj.has_next(),
            },
        })

    # ── Legacy mode: full list (used by analytics + dashboard JS) ──
    data = [_serialize(inc) for inc in incidents_queryset]
    return JsonResponse(data, safe=False)

@login_required(login_url="login")
@require_http_methods(["GET", "POST"])
def log_incident(request):
    role_check = _check_role(request, ["admin", "reporter"], response_type="redirect" if request.method == "GET" else "json")
    if role_check:
        return role_check

    if request.method == "POST":
        valid_categories = {c for c, _ in Incident.Category.choices}
        inc_type          = request.POST.get("inc_type", "").strip()
        description       = request.POST.get("description", "").strip()
        location          = request.POST.get("location", "").strip()
        specific_location = request.POST.get("specific_location", "").strip()
        notes             = request.POST.get("notes", "").strip()

        errors = {}
        if not inc_type:
            errors["inc_type"] = "Incident type is required."
        elif inc_type not in valid_categories:
            errors["inc_type"] = "Invalid incident type."
        if not description:
            errors["description"] = "Description is required."
        elif len(description) > 2000:
            errors["description"] = "Description must be at most 2000 characters."
        if not location:
            errors["location"] = "Location is required."
        elif len(location) > 255:
            errors["location"] = "Location must be at most 255 characters."
        if len(specific_location) > 255:
            errors["specific_location"] = "Specific location must be at most 255 characters."
        if len(notes) > 2000:
            errors["notes"] = "Notes must be at most 2000 characters."

        # Check if it's an AJAX request
        is_ajax = request.META.get('HTTP_X_REQUESTED_WITH') == 'XMLHttpRequest'

        if errors:
            if is_ajax:
                return JsonResponse({"success": False, "errors": errors}, status=400)
            return redirect("incidents")

        # Run ML classification for the alternate/manual incident-entry path too.
        ml_result = None
        try:
            ml_result = classify_incident(description)
        except Exception as ml_error:
            ml_result = {
                "category": None,
                "label": "Unavailable",
                "confidence_percent": 0.0,
                "error": str(ml_error),
            }

        note_parts = [notes] if notes else []
        if ml_result.get("category"):
            note_parts.extend([
                "ML Classification: %s (%s)" % (
                    ml_result["label"], ml_result["category"]
                ),
                "ML Confidence: %.2f%%" % ml_result["confidence_percent"],
                "Reporter Selected Type: %s" % inc_type,
            ])
        else:
            note_parts.append("ML Classification: unavailable")

        try:
            inc = Incident.objects.create(
                category=inc_type,
                description=description,
                location=location,
                specific_location=specific_location,
                operator_notes="\n".join(note_parts) or None,
                reported_by=request.user,
                status=Incident.Status.ACTIVE,
            )

            # Create notification for all users
            # (or you could filter to admins only: User.objects.filter(role='admin'))
            Notification.objects.create(
                incident=inc,
                user=None,  # Broadcast to all users
            )
        except Exception:
            if is_ajax:
                return JsonResponse({"success": False, "error": "Unable to save the incident. Please try again."}, status=500)
            return redirect("incidents")

        create_audit_log(
            request=request,
            action="create",
            model_name="Incident",
            object_id=str(inc.id),
            changes={
                "type": inc_type,
                "description": description,
                "location": location,
                "specific_location": specific_location,
                "ml_category": ml_result.get("category") if ml_result else None,
                "ml_confidence": ml_result.get("confidence_percent") if ml_result else None,
            }
        )

        if not is_ajax:
            messages.success(request, "Incident dispatched and logged successfully.")
        
        # Return JSON for AJAX requests, redirect for regular form submissions
        if is_ajax:
            return JsonResponse({
                "success": True,
                "incident": {
                    "id": str(inc.id),
                    "uuid": str(inc.id),
                    "type": inc.category,
                    "desc": inc.description,
                    "location": inc.location,
                    "specific_location": inc.specific_location,
                }
            })
        return redirect("incidents")

    return redirect("incidents")

@login_required(login_url="login")
@require_http_methods(["POST"])
def resolve_incident(request, incident_uuid):
    role_check = _check_role(request, ["admin"])
    if role_check:
        return role_check

    try:
        inc = Incident.objects.get(id=incident_uuid)
        # Idempotent: re-resolving must not bump resolved_at or double-audit.
        # (mark_resolved already writes the single RESOLVE audit row.)
        if inc.status == Incident.Status.RESOLVED:
            return JsonResponse({
                "success": True,
                "already_resolved": True,
                "resolvedAtRaw": int(inc.resolved_at.timestamp() * 1000) if inc.resolved_at else None,
            })
        inc.mark_resolved(resolved_by=request.user)
        return JsonResponse({
            "success": True,
            "resolvedAtRaw": int(inc.resolved_at.timestamp() * 1000) if inc.resolved_at else None,
        })
    except Incident.DoesNotExist:
        return JsonResponse({"success": False, "error": "Not found"}, status=404)
    except Exception:
        return JsonResponse({"success": False, "error": "Unable to resolve the incident. Please try again."}, status=500)

@login_required(login_url="login")
@require_http_methods(["GET"])
def notifications_api(request):
    """Fetch unread notifications from database (per-user read state)."""
    notifications = Notification.objects.filter(
        is_read=False
    ).filter(
        Q(user__isnull=True) | Q(user=request.user)
    ).exclude(
        read_by=request.user
    ).select_related('incident').order_by('-created_at')[:20]
    
    data = []
    for notif in notifications:
        inc = notif.incident
        data.append({
            'id': str(notif.id),
            'incident_id': str(inc.id),
            'type': inc.category,
            'desc': inc.description or '',
            'location': inc.location or '',
            'specific_location': inc.specific_location or '',
            'status': inc.status,
            'time': inc.created_at.isoformat(),
            'timeRaw': int(inc.created_at.timestamp() * 1000),
        })
    
    return JsonResponse(data, safe=False)

@login_required(login_url="login")
@require_http_methods(["POST"])
def mark_notification_read(request, notification_id):
    """Mark a notification as read — for the requesting user only."""
    try:
        notif = Notification.objects.filter(
            id=notification_id
        ).filter(
            Q(user__isnull=True) | Q(user=request.user)
        ).get()
        notif.read_by.add(request.user)
        # Personal rows keep the legacy flag in sync; broadcast rows must
        # NOT flip shared is_read (that would clear them for everyone).
        if notif.user_id is not None:
            notif.is_read = True
            notif.save(update_fields=["is_read"])
        return JsonResponse({"success": True})
    except Notification.DoesNotExist:
        return JsonResponse({"success": False, "error": "Not found"}, status=404)
    except Exception:
        return JsonResponse({"success": False, "error": "Unable to update the notification."}, status=500)

@login_required(login_url="login")
@require_http_methods(["POST"])
def mark_all_notifications_read(request):
    """Mark all unread notifications as read — for the requesting user only."""
    unread = Notification.objects.filter(
        is_read=False
    ).filter(
        Q(user__isnull=True) | Q(user=request.user)
    ).exclude(
        read_by=request.user
    )
    for notif in unread:
        notif.read_by.add(request.user)
        if notif.user_id is not None:
            notif.is_read = True
            notif.save(update_fields=["is_read"])
    return JsonResponse({"success": True})

@login_required(login_url="login")
@require_http_methods(["POST"])
def activate_incident(request, incident_uuid):
    """Mark an incident as active"""
    role_check = _check_role(request, ["admin"])
    if role_check:
        return role_check

    try:
        inc = Incident.objects.get(id=incident_uuid)
        inc.status = Incident.Status.ACTIVE
        inc.resolved_at = None
        inc.save()
        
        create_audit_log(
            request=request,
            action="update",
            model_name="Incident",
            object_id=str(inc.id),
            changes={"status": "active"}
        )
        return JsonResponse({"success": True, "status": "active"})
    except Incident.DoesNotExist:
        return JsonResponse({"success": False, "error": "Not found"}, status=404)
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

@login_required(login_url="login")
@require_http_methods(["POST"])
def delete_incident(request, incident_uuid):
    """Delete an incident"""
    role_check = _check_role(request, ["admin"])
    if role_check:
        return role_check

    try:
        inc = Incident.objects.select_related('reported_by').get(id=incident_uuid)
        inc_id = str(inc.id)
        
        # Store data for audit log before deletion
        audit_data = {
            "status": inc.status, 
            "description": inc.description,
            "category": inc.category,
            "location": inc.location
        }
        
        # Delete first for better performance
        inc.delete()
        
        # Create audit log after deletion (non-blocking)
        try:
            create_audit_log(
                request=request,
                action="delete",
                model_name="Incident",
                object_id=inc_id,
                changes=audit_data
            )
        except Exception:
            # Don't fail the deletion if audit logging fails
            pass
            
        return JsonResponse({"success": True})
    except Incident.DoesNotExist:
        return JsonResponse({"success": False, "error": "Not found"}, status=404)
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

@login_required(login_url="login")
@require_http_methods(["POST"])
def log_export(request):
    try:
        content_type = request.META.get("CONTENT_TYPE", "")
        if content_type.startswith("application/json"):
            payload = json.loads(request.body.decode("utf-8") or "{}")
        else:
            payload = request.POST.dict()

        # Export logging is intentionally available to any authenticated
        # role (reporters export their own history). Validate + cap the
        # client-controlled values so the audit trail can't be forged/bloated.
        allowed_pages = {"incidents", "analytics", "users", "my_reports", "dashboard"}
        page = str(payload.get("page", "unknown") or "unknown")[:50]
        if page not in allowed_pages:
            return JsonResponse({"success": False, "error": "Invalid export source."}, status=400)
        details = payload.get("details", {})
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {"raw": details[:500]}
        if not isinstance(details, dict):
            details = {"raw": str(details)[:500]}
        details = {str(k)[:50]: str(v)[:500] for k, v in list(details.items())[:20]}

        create_audit_log(
            request=request,
            action="export",
            model_name="CSVExport",
            object_id=page,
            changes=details or {}
        )
        return JsonResponse({"success": True})
    except Exception:
        return JsonResponse({"success": False, "error": "Unable to log the export."}, status=500)

@login_required(login_url="login")
@admin_required(response_type="redirect")
def analytics(request):
    if request.user.role != "admin":
        return redirect("dashboard")
    active_incidents_count = Incident.objects.filter(status='active').count()
    return render(request, "analytics.html", {
        'sidebar_incidents_badge': active_incidents_count,
    })

@login_required(login_url="login")
@admin_required(response_type="redirect")
def user_management(request):
    if request.user.role != "admin":
        return redirect("dashboard")
 
    users = User.objects.all()
    active_incidents_count = Incident.objects.filter(status="active").count()
 
    return render(request, "user_management.html", {
        # stat strip — these are rendered server-side on first load
        "total_users":    users.count(),
        "admin_count":    users.filter(role="admin").count(),
        "reporter_count": users.filter(role="reporter").count(),
        "active_count":   users.filter(is_active=True).count(),
        # sidebar
        "sidebar_incidents_badge": active_incidents_count,
    })
 
 
# ── 2. REST-style API  /api/users/ ───────────────────────────
 
def _user_to_dict(u):
    """Serialize a User instance to the shape expected by users.js."""
    # Prefer the annotated count (list view) to avoid an N+1 query per row.
    incident_count = u.__dict__.get("annotated_incident_count")
    if incident_count is None:
        incident_count = u.reported_incidents.count()
    return {
        "id":              str(u.id),          # UUID → string
        "first_name":      u.first_name,
        "last_name":       u.last_name,
        "email":           u.email,
        "username":        u.username,
        "role":            u.role,
        "status":          "active" if u.is_active else "inactive",
        "clearance_level": getattr(u, "clearance_level", 1),
        "date_joined":     u.date_joined.isoformat() if u.date_joined else None,
        "last_login":      u.last_login.isoformat()  if u.last_login  else None,
        "incident_count":  incident_count,
    }
 
 
@login_required(login_url="login")
@admin_required(response_type="json")
@require_http_methods(["GET", "POST"])
def users_api(request):
    """GET /api/users/  →  list all users
       POST /api/users/ →  create a user"""
 
    if request.user.role != "admin":
        return JsonResponse({"error": "Forbidden"}, status=403)
 
    # ── LIST ──────────────────────────────────────────────────
    if request.method == "GET":
        users = User.objects.all().order_by("-date_joined").annotate(
            annotated_incident_count=Count("reported_incidents")
        )
        data = [_user_to_dict(u) for u in users]
        return JsonResponse(data, safe=False)
 
    # ── CREATE ────────────────────────────────────────────────
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
 
    required = ["first_name", "last_name", "email", "username", "student_id", "password"]
    missing  = [f for f in required if not str(body.get(f, "") or "").strip()]
    if missing:
        return JsonResponse({"error": f"Missing fields: {', '.join(missing)}"}, status=400)

    first_name = body["first_name"].strip()
    last_name  = body["last_name"].strip()
    email      = body["email"].strip()
    username   = body["username"].strip()
    student_id = body["student_id"].strip()
    role = str(body.get("role", "reporter") or "reporter").strip().lower()
    if role not in (User.Role.REPORTER, User.Role.ADMIN):
        return JsonResponse({"error": "Invalid role. Must be 'reporter' or 'admin'."}, status=400)

    if User.objects.filter(username=username).exists():
        return JsonResponse({"error": "Username already taken."}, status=400)
    if User.objects.filter(email=email).exists():
        return JsonResponse({"error": "Email already registered."}, status=400)
    if User.objects.filter(student_id=student_id).exists():
        return JsonResponse({"error": "Student ID already registered."}, status=400)
    if len(body["password"]) < 8:
        return JsonResponse({"error": "Password must be at least 8 characters."}, status=400)
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}$', email):
        return JsonResponse({"error": "Invalid email address."}, status=400)

    try:
        clearance_level = int(body.get("clearance_level", 1))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Invalid clearance_level."}, status=400)

    u = User.objects.create(
        first_name      = first_name,
        last_name       = last_name,
        email           = email,
        username        = username,
        student_id      = student_id,
        password        = make_password(body["password"]),
        role            = role,
        is_active       = True,
    )
    # Optional clearance_level field (only if your User model has it)
    if hasattr(u, "clearance_level"):
        u.clearance_level = clearance_level
        u.save(update_fields=["clearance_level"])
 
    create_audit_log(
        request=request,
        action="create",
        model_name="User",
        object_id=str(u.id),
        changes={"username": u.username, "role": u.role},
    )
    return JsonResponse(_user_to_dict(u), status=201)
 
 
@login_required(login_url="login")
@admin_required(response_type="json")
@require_http_methods(["GET", "PATCH", "DELETE"])
def user_detail_api(request, user_id):
    """GET    /api/users/<id>/  →  single user
       PATCH  /api/users/<id>/  →  update
       DELETE /api/users/<id>/  →  delete"""
 
    if request.user.role != "admin":
        return JsonResponse({"error": "Forbidden"}, status=403)
 
    try:
        u = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({"error": "User not found."}, status=404)
 
    # ── GET ───────────────────────────────────────────────────
    if request.method == "GET":
        return JsonResponse(_user_to_dict(u))
 
    # ── UPDATE ────────────────────────────────────────────────
    if request.method == "PATCH":
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
 
        def _clean_str(value, fallback):
            if value is None:
                return fallback or ""
            return str(value).strip()

        # Uniqueness checks (exclude self)
        new_username = _clean_str(body.get("username", u.username), u.username)
        new_email    = _clean_str(body.get("email", u.email), u.email)
        if not new_username:
            return JsonResponse({"error": "Username cannot be empty."}, status=400)
        if not new_email:
            return JsonResponse({"error": "Email cannot be empty."}, status=400)
        if new_username != u.username and User.objects.filter(username=new_username).exists():
            return JsonResponse({"error": "Username already taken."}, status=400)
        if new_email != u.email and User.objects.filter(email=new_email).exists():
            return JsonResponse({"error": "Email already registered."}, status=400)

        new_role = str(body.get("role", u.role) or u.role).strip().lower()
        if new_role not in (User.Role.REPORTER, User.Role.ADMIN):
            return JsonResponse({"error": "Invalid role. Must be 'reporter' or 'admin'."}, status=400)
        new_status = str(body.get("status", "active" if u.is_active else "inactive") or "inactive").strip().lower()
        if new_status not in ("active", "inactive"):
            return JsonResponse({"error": "Invalid status. Must be 'active' or 'inactive'."}, status=400)

        # No self-demote / self-deactivate (prevents admin lockout).
        is_self = str(u.id) == str(request.user.id)
        if is_self and (new_role != User.Role.ADMIN or new_status != "active"):
            return JsonResponse({"error": "You cannot change your own role or deactivate your own account."}, status=400)

        u.first_name = _clean_str(body.get("first_name", u.first_name), u.first_name)
        u.last_name  = _clean_str(body.get("last_name",  u.last_name), u.last_name)
        u.email      = new_email
        u.username   = new_username
        u.role       = new_role
        u.is_active  = (new_status == "active")

        if hasattr(u, "clearance_level"):
            try:
                u.clearance_level = int(body.get("clearance_level", u.clearance_level))
            except (TypeError, ValueError):
                return JsonResponse({"error": "Invalid clearance_level."}, status=400)

        if body.get("password"):
            if len(body["password"]) < 8:
                return JsonResponse({"error": "Password must be at least 8 characters."}, status=400)
            u.password = make_password(body["password"])
 
        u.save()
 
        create_audit_log(
            request=request,
            action="update",
            model_name="User",
            object_id=str(u.id),
            changes={"username": u.username, "role": u.role, "status": u.is_active},
        )
        return JsonResponse(_user_to_dict(u))
 
    # ── DELETE ────────────────────────────────────────────────
    if str(u.id) == str(request.user.id):
        return JsonResponse({"error": "You cannot delete your own account."}, status=400)
 
    uid = str(u.id)
    uname = u.username
    u.delete()
 
    create_audit_log(
        request=request,
        action="delete",
        model_name="User",
        object_id=uid,
        changes={"username": uname},
    )
    return JsonResponse({"success": True}, status=200)

def _format_audit_changes(changes):
    if not changes:
        return []

    if isinstance(changes, dict):
        rows = []
        for key, value in changes.items():
            label = key.replace("_", " ").capitalize()
            if isinstance(value, dict):
                if "old" in value or "new" in value:
                    rows.append({
                        "label": label,
                        "value": f"{value.get('old', '-') or '-'} → {value.get('new', '-') or '-'}",
                    })
                else:
                    nested_items = []
                    for subkey, subvalue in value.items():
                        nested_items.append(f"{subkey.replace('_', ' ').capitalize()}: {subvalue}")
                    rows.append({
                        "label": label,
                        "value": "; ".join(nested_items) or "-",
                    })
            else:
                rows.append({
                    "label": label,
                    "value": value,
                })
        return rows

    return [{"label": "Details", "value": str(changes)}]


def _serialize_audit_changes(changes):
    if not changes:
        return []

    rows = []
    if isinstance(changes, dict):
        for key, value in changes.items():
            label = key.replace("_", " ").capitalize()
            if isinstance(value, dict):
                if "old" in value or "new" in value:
                    rows.append({
                        "label": label,
                        "value": f"{value.get('old', '-') or '-'} → {value.get('new', '-') or '-'}",
                    })
                else:
                    nested_items = []
                    for subkey, subvalue in value.items():
                        nested_items.append(f"{subkey.replace('_', ' ').capitalize()}: {subvalue}")
                    rows.append({
                        "label": label,
                        "value": "; ".join(nested_items) or "-",
                    })
            else:
                rows.append({
                    "label": label,
                    "value": value,
                })
        return rows

    return [{"label": "Details", "value": str(changes)}]


@login_required(login_url="login")
def settings(request):
    active_incidents_count = Incident.objects.filter(status='active').count()
    page_number = request.GET.get('page', 1)
    is_ajax = request.headers.get('x-requested-with') == 'XMLHttpRequest' or request.GET.get('ajax') == '1'

    audit_logs_qs = AuditLog.objects.filter(user=request.user).order_by('-timestamp')
    paginator = Paginator(audit_logs_qs, 10)
    try:
        audit_logs = paginator.page(page_number)
    except PageNotAnInteger:
        audit_logs = paginator.page(1)
    except EmptyPage:
        audit_logs = paginator.page(paginator.num_pages)

    for log in audit_logs.object_list:
        log.display_changes = _serialize_audit_changes(log.changes)

    if is_ajax:
        data = []
        for log in audit_logs.object_list:
            data.append({
                "action": log.get_action_display(),
                "model_name": log.model_name,
                "object_id": log.object_id,
                "timestamp": log.timestamp.strftime("%Y-%m-%d %H:%M"),
                "changes": log.display_changes,
            })
        return JsonResponse({
            "audit_logs": data,
            "pagination": {
                "page": audit_logs.number,
                "num_pages": audit_logs.paginator.num_pages,
                "has_previous": audit_logs.has_previous(),
                "has_next": audit_logs.has_next(),
                "previous_page": audit_logs.previous_page_number() if audit_logs.has_previous() else None,
                "next_page": audit_logs.next_page_number() if audit_logs.has_next() else None,
                "page_range": list(audit_logs.paginator.page_range),
            },
        })

    return render(request, "settings.html", {
        "active_incidents_count": active_incidents_count,
        "sidebar_incidents_badge": active_incidents_count,
        "audit_logs": audit_logs,
    })

@login_required(login_url="login")
@require_http_methods(["POST"])
def settings_profile(request):
    username = request.POST.get("username", "").strip()
    first_name = request.POST.get("first_name", "").strip()
    middle_name = request.POST.get("middle_name", "").strip()
    last_name = request.POST.get("last_name", "").strip()

    if not username or not first_name or not last_name:
        return JsonResponse({"success": False, "error": "Username, first name, and last name are required."}, status=400)

    if username != request.user.username and User.objects.filter(username=username).exists():
        return JsonResponse({"success": False, "error": "Username already taken."}, status=400)

    changed_fields = {}
    if request.user.username != username:
        changed_fields["username"] = {"old": request.user.username, "new": username}
        request.user.username = username
    if request.user.first_name != first_name:
        changed_fields["first_name"] = {"old": request.user.first_name, "new": first_name}
        request.user.first_name = first_name
    if request.user.middle_name != middle_name:
        changed_fields["middle_name"] = {"old": request.user.middle_name, "new": middle_name}
        request.user.middle_name = middle_name
    if request.user.last_name != last_name:
        changed_fields["last_name"] = {"old": request.user.last_name, "new": last_name}
        request.user.last_name = last_name

    request.user.save(update_fields=["username", "first_name", "middle_name", "last_name"])

    if changed_fields:
        try:
            create_audit_log(
                request=request,
                action="update",
                model_name="User",
                object_id=str(request.user.id),
                changes=changed_fields,
            )
        except Exception:
            pass

    return JsonResponse({"success": True, "message": "Profile updated successfully."})

@login_required(login_url="login")
@require_http_methods(["POST"])
def settings_password(request):
    old_password = request.POST.get("old_password", "")
    new_password1 = request.POST.get("new_password1", "")
    new_password2 = request.POST.get("new_password2", "")

    if not old_password or not new_password1 or not new_password2:
        return JsonResponse({"success": False, "error": "All password fields are required."}, status=400)

    if new_password1 != new_password2:
        return JsonResponse({"success": False, "error": "New passwords do not match."}, status=400)

    if len(new_password1) < 8:
        return JsonResponse({"success": False, "error": "Password must be at least 8 characters."}, status=400)

    try:
        validate_password(new_password1, request.user)
    except DjangoValidationError as ve:
        return JsonResponse({"success": False, "error": " ".join(ve.messages)}, status=400)

    if not request.user.check_password(old_password):
        return JsonResponse({"success": False, "error": "Current password is incorrect."}, status=400)

    request.user.set_password(new_password1)
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)

    try:
        create_audit_log(
            request=request,
            action="update",
            model_name="User",
            object_id=str(request.user.id),
            changes={"password": "updated"},
        )
    except Exception:
        pass

    return JsonResponse({"success": True, "message": "Password updated successfully."})



# ============================================================
#  ADD THESE TO views.py
# ============================================================

import json as _json_mod   # already imported as `json` in the original file

# ── Helper: format a location string ──────────────────────────
def _fmt_loc(raw):
    if not raw:
        return ''
    cleaned = raw.replace('_', ' ').replace('-', ' ').strip()
    return ' '.join(cleaned.split()).title()


# ── My Reports page ───────────────────────────────────────────
@login_required(login_url="login")
def my_reports(request):
    """Show the current user's own filed reports."""
    qs = Incident.objects.filter(reported_by=request.user).order_by('-created_at')

    # Counts
    total_count       = qs.count()
    active_count      = qs.filter(status__in=['active', 'dispatched', 'onscene', 'investigating']).count()
    resolved_count    = qs.filter(status='resolved').count()
    cancelled_count   = qs.filter(status='cancelled').count()
    dispatched_count  = qs.filter(status='dispatched').count()
    onscene_count     = qs.filter(status='onscene').count()
    investigating_count = qs.filter(status='investigating').count()

    reports = []
    reports_json = []

    for inc in qs:
        loc_display = _fmt_loc(inc.location or inc.specific_location or '')
        created_display  = inc.created_at.strftime('%b %d, %Y · %H:%M')  if inc.created_at  else '—'
        resolved_display = inc.resolved_at.strftime('%b %d, %Y · %H:%M') if inc.resolved_at else None

        # For template rendering
        inc.location_display = loc_display
        reports.append(inc)

        # For JS consumption
        reports_json.append({
            'id':                str(inc.id),
            'category':          inc.category,
            'status':            inc.status,
            'description':       inc.description or '',
            'location':          inc.location or '',
            'location_display':  loc_display,
            'specific_location': inc.specific_location or '',
            'created_at_display':  created_display,
            'resolved_at_display': resolved_display,
        })

    return render(request, 'my_reports.html', {
        'reports':             reports,
        'reports_json':        reports_json,   # pass Python object for json_script
        'total_count':         total_count,
        'active_count':        active_count,
        'resolved_count':      resolved_count,
        'cancelled_count':     cancelled_count,
        'dispatched_count':    dispatched_count,
        'onscene_count':       onscene_count,
        'investigating_count': investigating_count,
        # sidebar
        'active_incidents_count': Incident.objects.filter(status='active').count(),
        'sidebar_incidents_badge': Incident.objects.filter(status='active').count(),
    })


# ── Cancel own report (AJAX POST) ─────────────────────────────
@login_required(login_url="login")
@require_http_methods(["POST"])
def my_report_cancel(request, incident_uuid):
    """
    Let a reporter cancel their own active/investigating report.
    Admins may cancel any report.
    """
    try:
        inc = Incident.objects.get(id=incident_uuid)
    except Incident.DoesNotExist:
        return JsonResponse({"success": False, "error": "Report not found."}, status=404)

    # Ownership check: reporter can only cancel their own reports
    if request.user.role != 'admin' and inc.reported_by_id != request.user.id:
        return JsonResponse({"success": False, "error": "You can only cancel your own reports."}, status=403)

    # Any not-yet-final report can be cancelled. Final states
    # (resolved / already cancelled) are terminal.
    cancellable = {'active', 'dispatched', 'onscene', 'investigating'}
    if inc.status not in cancellable:
        return JsonResponse({
            "success": False,
            "error": f"Reports with status '{inc.status}' cannot be cancelled."
        }, status=400)

    inc.status = Incident.Status.CANCELLED
    inc.resolved_at = None
    inc.save(update_fields=['status', 'resolved_at'])

    create_audit_log(
        request=request,
        action="update",
        model_name="Incident",
        object_id=str(inc.id),
        changes={"status": "cancelled", "cancelled_by": str(request.user.id)},
    )
    # Let admins see the cancellation in their notification feed.
    Notification.objects.create(incident=inc, user=None)

    return JsonResponse({"success": True, "status": "cancelled", "message": "Report cancelled successfully."})
