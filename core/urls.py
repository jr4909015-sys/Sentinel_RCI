from django.urls import path

from core import views


urlpatterns = [
    path("", views.landing_page, name="landing"),
    path("login/", views.UserLoginView.as_view(), name="login"),
    path("register/", views.register, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("dashboard/", views.dashboard, name="dashboard"),
    path("livemap/", views.livemap, name="livemap"),
    path("api/dashboard-stats/", views.dashboard_stats_api, name="dashboard_stats_api"),
    path("api/activity-chart/", views.activity_chart_api, name="activity_chart_api"),
    path("report/", views.report, name="report"),
    path("api/report-incident/", views.report_incident_api, name="report_incident_api"),
    path("api/chatbot/", views.chatbot_api, name="chatbot_api"),
    path("api/classify-incident/", views.classify_incident_api, name="classify_incident_api"),
    path("incidents/", views.incidents, name="incidents"),
    path("api/incidents/", views.incidents_api, name="incidents_api"),
    path("api/notifications/", views.notifications_api, name="notifications_api"),
    path("api/notifications/<uuid:notification_id>/read/", views.mark_notification_read, name="mark_notification_read"),
    path("add/incident/", views.log_incident, name="log_incident"),
    path("api/incidents/<uuid:incident_uuid>/resolve/", views.resolve_incident, name="resolve_incident"),
    path("api/incidents/<uuid:incident_uuid>/activate/", views.activate_incident, name="activate_incident"),
    path("api/incidents/<uuid:incident_uuid>/delete/", views.delete_incident, name="delete_incident"),
    path('api/notifications/read/', views.mark_all_notifications_read, name='notifications_read'),
    path('api/export-log/', views.log_export, name='export_log'),
    path("analytics/", views.analytics, name="analytics"),
    path("users/", views.user_management, name="users"),
    path("api/users/",    views.users_api,       name="users_api"),
    path("api/users/<uuid:user_id>/", views.user_detail_api, name="user_detail_api"),
    path("settings/", views.settings, name="settings"),
    path("settings/profile/", views.settings_profile, name="settings_profile"),
    path("settings/password/", views.settings_password, name="settings_password"),
    path('my-reports/',views.my_reports,name='my_reports'),
    path('api/my-reports/<uuid:incident_uuid>/cancel/', views.my_report_cancel, name='my_report_cancel'),
]