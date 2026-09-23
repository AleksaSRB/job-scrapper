# Uklanja Scheduled Task-ove "MamaPosloviScraper" i "MamaPosloviServer" i gasi server proces (onaj koji slusa na portu iz config.json).
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3003
try { $Port = (Get-Content (Join-Path $Root 'config.json') -Raw | ConvertFrom-Json).port } catch { }
foreach ($TaskName in 'MamaPosloviScraper', 'MamaPosloviServer') {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' uklonjen."
  } else {
    Write-Host "Task '$TaskName' ne postoji."
  }
}
# Po portu, ne po komandnoj liniji: drugi scraperi imaju istu komandnu liniju (src\server.ts) i ne smeju da stradaju.
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force; Write-Host "Server proces $_ (port $Port) ugasen." }
Write-Host 'Podaci (data/db.json - favoriti, statusi) su ostali netaknuti.'
