#!/usr/bin/env bash

set -o errexit

pip install -r requirements.txt

python manage.py collectstatic --no-input

python manage.py migrate

python manage.py shell -c "
from core.models import User
import os

username = os.environ.get('ADMIN_USERNAME')
password = os.environ.get('ADMIN_PASSWORD')
student_id = os.environ.get('ADMIN_STUDENT_ID', 'RCI-ADMIN-001')

if username and password:
    user, created = User.objects.get_or_create(
        username=username,
        defaults={
            'student_id': student_id,
            'first_name': 'RCI',
            'middle_name': '',
            'last_name': 'Administrator',
            'email': 'admin@rcisentinel.local',
            'role': 'admin',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
        }
    )

    if created:
        user.set_password(password)
        user.save()
        print('RCI ADMIN CREATED SUCCESSFULLY')
    else:
        user.role = 'admin'
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.save()
        print('RCI ADMIN ALREADY EXISTS - SETTINGS VERIFIED')
else:
    print('ADMIN ENVIRONMENT VARIABLES NOT SET - SKIPPING ADMIN CREATION')
"