from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html
from .models import User, Incident, AuditLog, IncidentAnalytics, Notification


# =========================
# 👤 USER ADMIN
# =========================
@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "role", "is_staff")
    list_filter = ("role", "is_staff")
    search_fields = ("username", "email", "student_id")

    fieldsets = BaseUserAdmin.fieldsets + (
        ("Custom Fields", {
            "fields": ( "middle_name", "role", "student_id")
        }),
    )

# =========================
# Notifications Admin
# =========================
@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("short_id", "incident", "user", "is_read", "created_at")
    list_filter = ("is_read", "created_at")
    search_fields = ("incident__description", "user__username")

    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

# =========================
# 📍 INCIDENT ADMIN
# =========================
@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = (
        "short_id",
        "category",
        "status_badge",
        "reported_by",
        "created_at",
        "resolved_at",
    )

    list_filter = ("status", "category", "created_at")
    search_fields = ("description",)
    readonly_fields = ("created_at", "resolved_at")

    actions = ["mark_as_resolved"]

    # =========================
    # 🔍 DISPLAY HELPERS
    # =========================
    def short_id(self, obj):
        return str(obj.id)[:8]
    short_id.short_description = "ID"

    def status_badge(self, obj):
        color = "red" if obj.status == "active" else "green"
        return format_html(
            '<span style="color: white; padding: 3px 8px; border-radius: 5px; background-color: {};">{}</span>',
            color,
            obj.status.upper()
        )
    status_badge.short_description = "Status"

    # =========================
    # ⚡ BULK ACTION
    # =========================
    def mark_as_resolved(self, request, queryset):
        for incident in queryset:
            if incident.status != Incident.Status.RESOLVED:
                incident.mark_resolved(resolved_by=request.user)

    mark_as_resolved.short_description = "Mark selected incidents as resolved"


# =========================
# AUDIT LOG ADMIN
# =========================
@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "action",
        "model_name",
        "object_id",
        "user",
        "timestamp",
    )

    list_filter = ("action", "model_name", "timestamp")
    search_fields = ("object_id", "model_name")

    readonly_fields = [field.name for field in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# =========================
# 📊 ANALYTICS ADMIN
# =========================
@admin.register(IncidentAnalytics)
class IncidentAnalyticsAdmin(admin.ModelAdmin):
    list_display = (
        "total_incidents",
        "active_incidents",
        "resolved_incidents",
        "generated_at",
    )

    readonly_fields = (
        "total_incidents",
        "active_incidents",
        "resolved_incidents",
        "generated_at",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False