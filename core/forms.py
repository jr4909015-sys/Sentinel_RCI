from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import get_user_model, authenticate
from django.core.cache import cache
from django.core.exceptions import ValidationError

User = get_user_model()

# Login brute-force guard: max failures per identifier+IP before lockout.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 600


def _login_fail_key(identifier, ip):
    return f"login_fail:{ip}:{identifier.strip().lower()}"


def _client_ip(request):
    if not request:
        return ""
    # REMOTE_ADDR only (X-Forwarded-For is spoofable without proxy config).
    return request.META.get("REMOTE_ADDR", "")


# =========================
# LOGIN FORM
# =========================
class LoginForm(AuthenticationForm):
    # NOTE: AuthenticationForm field order is (username, password).
    username = forms.CharField(
        widget=forms.TextInput(attrs={
            "id": "username",
            "class": "form-input",
            "placeholder": "Username or Student ID",
            "autocomplete": "username",
        })
    )

    password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            "id": "id_password",
            "class": "form-input",
            "placeholder": "Password",
            "autocomplete": "current-password",
            "style": "padding-right:44px",
        })
    )

    def clean(self):
        username_or_id = (self.cleaned_data.get("username") or "").strip()
        password = self.cleaned_data.get("password") or ""

        if not username_or_id:
            raise ValidationError("Please enter your username or Student ID.")
        if not password:
            raise ValidationError("Please enter your password.")

        # Brute-force guard (generic message reveals nothing).
        ip = _client_ip(getattr(self, "request", None))
        fail_key = _login_fail_key(username_or_id, ip)
        if (cache.get(fail_key, 0) or 0) >= LOGIN_MAX_ATTEMPTS:
            raise ValidationError(
                "Too many failed attempts. Please try again in a few minutes."
            )

        # ── UNIFIED PATH ──────────────────────────────────────────
        # Everyone authenticates with username-or-ID + password.
        # Student IDs resolve to their account username first.
        login_username = username_or_id
        account = User.objects.filter(username=username_or_id).first()
        if account is None:
            account = User.objects.filter(student_id=username_or_id).first()
        if account is not None:
            login_username = account.username

        user = authenticate(self.request, username=login_username, password=password)

        # Generic failure for wrong credentials AND disabled accounts
        # (no user-enumeration oracle).
        if user is None or not user.is_active:
            try:
                attempts = cache.get(fail_key, 0) or 0
                cache.set(fail_key, attempts + 1, LOGIN_LOCKOUT_SECONDS)
            except Exception:
                pass
            raise ValidationError(
                "Invalid username/ID or password.",
                code="invalid_login",
            )

        cache.delete(fail_key)
        self.user_cache = user
        return self.cleaned_data

    def get_user(self):
        return getattr(self, "user_cache", None)


# =========================
# REGISTRATION FORM
# =========================
class RegistrationForm(UserCreationForm):
    first_name = forms.CharField(
        max_length=30,
        required=True,
        widget=forms.TextInput(attrs={
            "id": "id_first_name",
            "class": "form-input",
            "placeholder": "First Name",
        })
    )

    last_name = forms.CharField(
        max_length=30,
        required=True,
        widget=forms.TextInput(attrs={
            "id": "id_last_name",
            "class": "form-input",
            "placeholder": "Last Name",
        })
    )

    student_id = forms.CharField(
        max_length=20,
        required=True,
        widget=forms.TextInput(attrs={
            "id": "id_student_id",
            "class": "form-input",
            "placeholder": "Student ID",
        })
    )

    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(attrs={
            "id": "id_email",
            "class": "form-input",
            "placeholder": "Email Address",
        })
    )

    username = forms.CharField(
        max_length=150,
        required=True,
        widget=forms.TextInput(attrs={
            "id": "id_username",
            "class": "form-input",
            "placeholder": "Username",
        })
    )

    password1 = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={
            "id": "id_password1",
            "class": "form-input",
            "placeholder": "Password",
        })
    )

    password2 = forms.CharField(
        label="Confirm Password",
        widget=forms.PasswordInput(attrs={
            "id": "id_password2",
            "class": "form-input",
            "placeholder": "Confirm Password",
        })
    )

    class Meta:
        model = User
        fields = (
            "first_name",
            "last_name",
            "student_id",
            "email",
            "username",
            "password1",
            "password2",
        )

    def clean_student_id(self):
        student_id = (self.cleaned_data.get("student_id") or "").strip()
        if User.objects.filter(student_id=student_id).exists():
            raise ValidationError("A user with this student ID already exists.")
        return student_id

    def clean_email(self):
        email = (self.cleaned_data.get("email") or "").strip()
        if User.objects.filter(email=email).exists():
            raise ValidationError("A user with this email already exists.")
        return email

    def clean_username(self):
        username = (self.cleaned_data.get("username") or "").strip()
        if User.objects.filter(username=username).exists():
            raise ValidationError("This username is already taken.")
        return username