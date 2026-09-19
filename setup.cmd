@echo off
rem Dupli klik = instalacija (proverava Node.js, registruje zadatke, radi prvi prolaz, otvara UI).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
