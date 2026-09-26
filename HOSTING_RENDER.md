# Sentinel RCI - Render Hosting

1. Push this folder to a GitHub repository.
2. Create a PostgreSQL database on Render.
3. Create a Render Web Service from the GitHub repository.
4. Root Directory: leave blank if the GitHub repository contains `manage.py` at its root. If you keep the outer `Sentinel_RCI` folder, set Root Directory to `Sentinel_RCI/RCI_Sentinel`.
5. Build Command: `./build.sh`
6. Start Command: `python -m gunicorn IRSYS.wsgi:application -k uvicorn.workers.UvicornWorker`
7. Add environment variables:
   - SECRET_KEY
   - GEMINI_API_KEY
   - GEMINI_MODEL=gemini-flash-lite-latest
   - FIELD_ENCRYPTION_KEY
   - DATABASE_URL (from Render PostgreSQL)
   - DEBUG=False
   - ALLOWED_HOSTS=localhost,127.0.0.1
   - CSRF_TRUSTED_ORIGINS=https://YOUR-SERVICE.onrender.com
8. Deploy.
9. Open Render Shell and run: `python manage.py createsuperuser`

IMPORTANT: Do not commit `.env` or any real API key. The old project had a Gemini key in source; revoke/rotate it before production.
