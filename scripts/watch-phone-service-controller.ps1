param(
  [Parameter(Mandatory = $true)][string]$ServerRoot,
  [int]$Port = 8786,
  [string]$TaskName = 'EnCroissantHomeServer'
)
$ErrorActionPreference = 'Stop'
$missed = Join-Path $ServerRoot 'controller-watchdog-missed.txt'
try {
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/pc-services" -TimeoutSec 3
  if ($health.ok -and $health.service -eq 'en-croissant-service-controller') {
    Remove-Item -LiteralPath $missed -ErrorAction SilentlyContinue
    exit 0
  }
} catch {}
$task = Get-ScheduledTask -TaskName $TaskName -TaskPath '\'
# This independent periodic trigger also covers a lost Scheduler failure retry.
if ($task.State -ne 'Running') {
  Start-ScheduledTask -InputObject $task
  exit 0
}
# Allow normal startup; require two missed checks before replacing a hung
# controller. Operational watchdog state is separate from services On/Off.
if (-not (Test-Path -LiteralPath $missed)) {
  Set-Content -LiteralPath $missed -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ascii
  exit 0
}
$since = [DateTime]::Parse((Get-Content -Raw -LiteralPath $missed))
if (([DateTime]::UtcNow - $since).TotalSeconds -lt 55) { exit 0 }
$launcherRoot = Join-Path $ServerRoot 'launcher'
$controllerScript = Join-Path $launcherRoot 'phone-service-controller.mjs'
$controllerRunner = Join-Path $launcherRoot 'run-phone-service-controller.ps1'
Stop-ScheduledTask -InputObject $task
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'node.exe' -and ([string]$_.CommandLine).Contains('"' + $controllerScript + '"')) -or
  ($_.Name -eq 'powershell.exe' -and ([string]$_.CommandLine).Contains('"' + $controllerRunner + '"'))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $missed -ErrorAction SilentlyContinue
Start-ScheduledTask -InputObject $task
