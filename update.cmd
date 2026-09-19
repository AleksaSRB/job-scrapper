@echo off
rem Dupli klik = povuci najnoviju verziju sa GitHub-a (git pull) i restartuj server. Podaci (data/) se ne diraju.
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git nije instaliran. Skini ZIP sa https://github.com/AleksaSRB/job-scrapper i prekopiraj fajlove preko postojecih ^(folder data\ ostavi^).
  pause
  exit /b 1
)
git pull --ff-only
if errorlevel 1 (
  echo git pull nije uspeo - vidi poruku iznad.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName MamaPosloviServer -ErrorAction SilentlyContinue; $p=3003; try { $p=(Get-Content '%~dp0config.json' -Raw | ConvertFrom-Json).port } catch {}; Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }; Start-Sleep 1; Start-ScheduledTask -TaskName MamaPosloviServer; Write-Host ('Server restartovan: http://localhost:' + $p)"
echo.
pause
