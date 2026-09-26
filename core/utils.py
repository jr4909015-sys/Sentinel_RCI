# core/utils.py
from .models import AuditLog


def create_audit_log(
    request,
    action,
    model_name,
    object_id,
    changes=None
):
    AuditLog.objects.create(
        user=request.user if request.user.is_authenticated else None,
        action=action,
        model_name=model_name,
        object_id=str(object_id),
        changes=changes or {},
        ip_address=get_client_ip(request)
    )


def get_client_ip(request):
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")

    if x_forwarded_for:
        return x_forwarded_for.split(",")[0]

    return request.META.get("REMOTE_ADDR")