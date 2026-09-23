# Instalacija na Windows-u (pokreni preko setup.cmd - dupli klik). Moze se pokretati vise puta (reinstalacija / nova verzija).
#   1. skine "Mark of the Web" sa fajlova (ZIP skinut sa interneta), proveri Node.js >= 22.6
#      (ako ga nema: winget -> ako ni to ne ide, skida zvanicni MSI sa nodejs.org i instalira ga; trazi UAC potvrdu)
#   2. proveri da port iz config.json (3003) nije zauzet drugim programom
#   3. registruje dva Scheduled Task-a bez prozora (prezivljavaju restart):
#        MamaPosloviScraper - svakih 15 min: src/scrape.ts (prvi prolaz uzima oglase iz poslednjih `lookbackDays` dana)
#        MamaPosloviServer  - pri logovanju (i odmah): src/server.ts na http://localhost:3003
#   4. napravi precicu "Poslovi od kuce" na Desktop-u
#   5. pokrene prvi prolaz odmah (vidljivo u ovom prozoru) i otvori UI u browseru
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

function Install-NodeFromMsi {
  # Zvanicni instaler sa nodejs.org (poslednji LTS). msiexec trazi administratorsku potvrdu (UAC).
  Write-Host 'Skidam Node.js LTS instaler sa nodejs.org...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $index | Where-Object { $_.lts -and $_.lts -ne $false } | Select-Object -First 1
  if (-not $lts) { throw 'Ne mogu da nadjem LTS verziju na nodejs.org' }
  $ver = $lts.version
  $msi = Join-Path $env:TEMP "node-$ver-x64.msi"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/node-$ver-x64.msi" -OutFile $msi -UseBasicParsing
  Write-Host "Instaliram Node.js $ver (potvrdi UAC prozor ako se pojavi)..."
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /passive /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "msiexec vratio $($p.ExitCode)" }
  Refresh-Path
}

Write-Host '== Poslovi od kuce: instalacija ==' -ForegroundColor Cyan
Write-Host "Folder: $Root"

# --- 1. Mark of the Web (fajlovi iz ZIP-a skinutog sa interneta) + Node ---
try { Get-ChildItem -Path $Root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch { }
if (-not (Node-Ok)) {
  Write-Host 'Node.js >= 22.6 nije pronadjen.' -ForegroundColor Yellow
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    Write-Host 'Instaliram Node.js LTS preko winget-a (moze potrajati par minuta)...'
    try { & winget.exe install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent; Refresh-Path } catch { Write-Host "winget nije uspeo: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if (-not (Node-Ok)) { try { Install-NodeFromMsi } catch { Write-Host "MSI instalacija nije uspela: $($_.Exception.Message)" -ForegroundColor Yellow } }
  if (-not (Node-Ok)) {
    throw 'Node.js >= 22.6 i dalje nije dostupan. Instaliraj ga rucno sa https://nodejs.org (LTS), zatvori ovaj prozor i ponovo pokreni setup.cmd.'
  }
}
Write-Host ("Node.js {0} OK" -f (& node.exe --version))
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Write-Host 'Upozorenje: curl.exe nije u PATH-u (koristi se samo kao rezerva za Cloudflare sajtove).' -ForegroundColor Yellow }

# --- 2. port ---
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($procId in $listeners) {
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  if ($name -ne 'node') { throw "Port $Port drzi program '$name' (PID $procId). Ugasi ga ili promeni `"port`" u config.json pa pokreni setup.cmd ponovo." }
}

New-Item -ItemType Directory -Force (Join-Path $Root 'data') | Out-Null
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# --- 3a. scraper (svakih 15 min, ponavlja se beskonacno; posle restarta/spavanja nastavlja sam) ---
$Action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B "{0}"' -f (Join-Path $Root 'run-hidden.vbs')) -WorkingDirectory $Root
# Bez -RepetitionDuration = ponavlja se beskonacno (Win11 odbija [TimeSpan]::MaxValue)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($IntervalMin) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMin)
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'MamaPosloviScraper' -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Host "Task 'MamaPosloviScraper' registrovan: svakih $IntervalMin min"

# --- 3b. server (pri logovanju + odmah; ako padne, Task Scheduler ga digne ponovo) ---
$Action2 = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B "{0}"' -f (Join-Path $Root 'run-server-hidden.vbs')) -WorkingDirectory $Root
$Trigger2 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Settings2 = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'MamaPosloviServer' -Action $Action2 -Trigger $Trigger2 -Settings $Settings2 -Principal $Principal -Force | Out-Null
# reinstalacija: ugasi stari server (samo node na NASEM portu) da se novi kod ucita
Stop-ScheduledTask -TaskName 'MamaPosloviServer' -ErrorAction SilentlyContinue
foreach ($procId in $listeners) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName 'MamaPosloviServer'
Write-Host "Task 'MamaPosloviServer' registrovan (pri logovanju) i pokrenut: http://localhost:$Port"

# --- 4. precica na Desktop-u ---
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'Poslovi od kuce.url'
  Set-Content -Path $lnk -Value "[InternetShortcut]`r`nURL=http://localhost:$Port`r`nIconIndex=0" -Encoding ASCII
  Write-Host "Precica: $lnk"
} catch { Write-Host "Precica nije napravljena: $($_.Exception.Message)" -ForegroundColor Yellow }

# --- 5. prvi prolaz odmah (vidljivo) ---
Write-Host ''
Write-Host 'Prvi prolaz: skidam oglase iz poslednjih dana sa svih sajtova (2-5 min)...' -ForegroundColor Cyan
# reinstalacija: ako zakazani sken bas sada radi, sacekaj da zavrsi (lock je svez najvise 15 min)
$lock = Join-Path $Root 'data\scrape.lock'
$waited = 0
while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 15 -and $waited -lt 300) { Start-Sleep -Seconds 5; $waited += 5 }
& node.exe --experimental-strip-types --disable-warning=ExperimentalWarning (Join-Path $Root 'src\scrape.ts') --force
Write-Host ''

# --- provera da server odgovara ---
$ok = $false
foreach ($i in 1..10) {
  try { $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/jobs" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { Start-Sleep -Seconds 1 }
}
if ($ok) { Write-Host "Gotovo. Server radi, otvaram http://localhost:$Port" -ForegroundColor Green }
else { Write-Host "Server ne odgovara na http://localhost:$Port - pogledaj data\server.out i data\scraper.log" -ForegroundColor Red }
Start-Process "http://localhost:$Port"
Write-Host 'Rucno paljenje: start.cmd | Nova verzija: update.cmd | Uklanjanje: uninstall.cmd'
