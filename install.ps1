# Instalacija na Windows-u (pokreni preko setup.cmd – dupli klik):
#   1. proveri Node.js >= 22.6 (ako ga nema, a postoji winget -> instalira Node.js LTS)
#   2. registruje dva Scheduled Task-a bez prozora:
#        MamaPosloviScraper - svakih 15 min: src/scrape.ts (prvi prolaz uzima oglase iz poslednjih `lookbackDays` dana)
#        MamaPosloviServer  - pri logovanju (i odmah): src/server.ts na http://localhost:3003
#   3. pokrene prvi prolaz odmah (vidljivo u ovom prozoru) i otvori UI u browseru
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$IntervalMin = 15
$Port = 3003
try { $cfg = Get-Content (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json; if ($cfg.port) { $Port = $cfg.port }; if ($cfg.intervalMin) { $IntervalMin = $cfg.intervalMin } } catch { }

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Node-Ok {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node.exe --version) -replace '^v', ''
  $parts = $v.Split('.')
  $major = [int]$parts[0]; $minor = [int]$parts[1]
  return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 6)
}

Write-Host '== Poslovi od kuce: instalacija ==' -ForegroundColor Cyan
if (-not (Node-Ok)) {
  Write-Host 'Node.js >= 22.6 nije pronadjen.' -ForegroundColor Yellow
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    Write-Host 'Instaliram Node.js LTS preko winget-a (moze potrajati par minuta)...'
    & winget.exe install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
  }
  if (-not (Node-Ok)) {
    throw 'Node.js >= 22.6 i dalje nije dostupan. Instaliraj ga rucno sa https://nodejs.org (LTS), zatvori ovaj prozor i ponovo pokreni setup.cmd.'
  }
}
Write-Host ("Node.js {0} OK" -f (& node.exe --version))
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Write-Host 'Upozorenje: curl.exe nije u PATH-u (koristi se samo kao rezerva za Cloudflare sajtove).' -ForegroundColor Yellow }

New-Item -ItemType Directory -Force (Join-Path $Root 'data') | Out-Null
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# --- scraper (svakih 15 min) ---
$Action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B "{0}"' -f (Join-Path $Root 'run-hidden.vbs')) -WorkingDirectory $Root
# Bez -RepetitionDuration = ponavlja se beskonacno (Win11 odbija [TimeSpan]::MaxValue)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($IntervalMin) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMin)
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 14) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'MamaPosloviScraper' -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Host "Task 'MamaPosloviScraper' registrovan: svakih $IntervalMin min"

# --- server (pri logovanju + odmah) ---
$Action2 = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B "{0}"' -f (Join-Path $Root 'run-server-hidden.vbs')) -WorkingDirectory $Root
$Trigger2 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Settings2 = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'MamaPosloviServer' -Action $Action2 -Trigger $Trigger2 -Settings $Settings2 -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName 'MamaPosloviServer'
Write-Host "Task 'MamaPosloviServer' registrovan (pri logovanju) i pokrenut: http://localhost:$Port"

# --- prvi prolaz odmah (vidljivo) ---
Write-Host ''
Write-Host 'Prvi prolaz: skidam oglase iz poslednjih dana sa svih sajtova (2-5 min)...' -ForegroundColor Cyan
& node.exe --experimental-strip-types --disable-warning=ExperimentalWarning (Join-Path $Root 'src\scrape.ts') --force
Write-Host ''
Write-Host "Gotovo. Otvaram http://localhost:$Port" -ForegroundColor Green
Start-Process "http://localhost:$Port"
Write-Host 'Uklanjanje: uninstall.cmd (ili .\uninstall.ps1)'
