@echo off
rem Dupli klik = uklanja zakazane zadatke i gasi server (podaci ostaju).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
