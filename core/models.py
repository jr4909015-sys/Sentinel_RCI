import uuid
from django.db import models
from django.utils import timezone
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.validators import RegexValidator
from cryptography.fernet import Fernet


# =========================
# 👤 CUSTOM USER MODEL
# =========================
class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student_id = models.CharField(max_length=20, unique=True)
    first_name = models.CharField(max_length=30)
    middle_name = models.CharField(max_length=30, blank=True, null=True)
    last_name = models.CharField(max_length=30)

    class Role(models.TextChoices):
        REPORTER = "reporter", "Reporter"
        ADMIN = "admin", "Admin"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.REPORTER
    )


    def __str__(self):
        return f"{self.username} ({self.role})"


# =========================
# 🔐 SIMPLE ENCRYPTION UTIL
# =========================
class SimpleEncryptor:
    def __init__(self):
        # Lazy cipher: importing models must never crash when no key is
        # configured (encryption is only needed where actually used).
        self.cipher = None

    def _get_cipher(self):
        if self.cipher is None:
            key = getattr(settings, "FIELD_ENCRYPTION_KEY", "")
            if not key:
                from django.core.exceptions import ImproperlyConfigured
                raise ImproperlyConfigured(
                    "FIELD_ENCRYPTION_KEY is not set. "
                    "Set it in the environment to use encryption."
                )
            self.cipher = Fernet(key)
        return self.cipher

    def encrypt(self, value: str) -> str:
        if not value:
            return value
        return self._get_cipher().encrypt(str(value).encode()).decode()

    def decrypt(self, value: str) -> str:
        if not value:
            return value
        return self._get_cipher().decrypt(value.encode()).decode()


encryptor = SimpleEncryptor()


# =========================
# 📍 INCIDENT MODEL
# =========================
class Incident(models.Model):

    class Category(models.TextChoices):
        FIRE = "fire", "Fire"
        MEDICAL = "med", "Medical"
        SECURITY = "sec", "Security"
        ACCIDENT = "accident", "Accident"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        DISPATCHED = "dispatched", "Dispatched"
        ONSCENE = "onscene", "On Scene"
        INVESTIGATING = "investigating", "Investigating"
        RESOLVED = "resolved", "Resolved"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=20, choices=Category.choices)
    description = models.TextField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)
    specific_location = models.CharField(max_length=255, blank=True, null=True)

    # GPS LOCATION
    latitude = models.DecimalField(
        max_digits=10,
        decimal_places=7,
        null=True,
        blank=True
    )

    longitude = models.DecimalField(
        max_digits=10,
        decimal_places=7,
        null=True,
        blank=True
    )

    location_accuracy = models.FloatField(
        null=True,
        blank=True
    )

    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="reported_incidents"
    )

    operator_notes = models.TextField(blank=True, null=True)

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE
    )

    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["created_at"]),
        ]

    # =========================
    # 🔐 PII HANDLING
    # =========================

    def mark_resolved(self, resolved_by=None):
        self.status = self.Status.RESOLVED
        self.resolved_at = timezone.now()
        self.save()

        AuditLog.objects.create(
            user=resolved_by,
            action=AuditLog.Action.RESOLVE,
            model_name="Incident",
            object_id=str(self.id),
            changes={"status": "resolved"}
        )

    def __str__(self):
        return f"{self.category} - {self.status} ({self.created_at})"


# =========================
# 📊 ANALYTICS SNAPSHOT
# =========================
class IncidentAnalytics(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    total_incidents = models.IntegerField(default=0)
    active_incidents = models.IntegerField(default=0)
    resolved_incidents = models.IntegerField(default=0)

    generated_at = models.DateTimeField(auto_now=True)


# =========================
# 🔔 NOTIFICATION
# =========================
class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    incident = models.ForeignKey(
        Incident,
        on_delete=models.CASCADE,
        related_name="notifications"
    )
    
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications"
    )
    
    is_read = models.BooleanField(default=False)
    # Per-user read receipts. Broadcast rows (user=None) are shared, so a
    # global is_read flip would mark them read for EVERYONE — readers must
    # be tracked per user here instead. (Legacy rows with is_read=True stay
    # hidden for all, preserving pre-migration behavior.)
    read_by = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="read_notifications",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["is_read", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["incident"]),  # For faster CASCADE deletions
        ]
    
    def __str__(self):
        return f"Notification for {self.incident.category} incident"


# =========================
# GENERIC AUDIT LOG
# =========================
class AuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"
        RESOLVE = "resolve", "Resolve"
        EXPORT = "export", "Export"
        LOGIN = "login", "Login"
        LOGOUT = "logout", "Logout"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )

    action = models.CharField(max_length=20, choices=Action.choices)

    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100)

    changes = models.JSONField(blank=True, null=True)

    timestamp = models.DateTimeField(auto_now_add=True)

    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.action} - {self.model_name} ({self.timestamp})"