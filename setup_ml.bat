@echo off
setlocal
cd /d "%~dp0"
echo Installing ML dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 goto :error
echo.
echo Training incident classifier...
python core\ml\train_model.py
if errorlevel 1 goto :error
echo.
echo Checking Django project...
python manage.py check
if errorlevel 1 goto :error
echo.
echo ML setup completed successfully.
echo Start the server with: python manage.py runserver
pause
exit /b 0
:error
echo.
echo ML setup failed. Read the error above.
pause
exit /b 1
