param(
  [string]$TaskName = "Stockfish18Remote",
  [string]$TaskPath = "\EnCroissant\",
  [string]$HealthUrl = "http://127.0.0.1:38419/v1/health"
)

$ErrorActionPreference = "Stop"

try {
  $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
  if ($health.ok -and $health.service -eq "stockfish-18-remote") {
    exit 0
  }
} catch {
  # The task restart below is the recovery path.
}

$task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
  Start-Sleep -Seconds 1
}
Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    if ($health.ok -and $health.service -eq "stockfish-18-remote") {
      exit 0
    }
  } catch {
  }
} while ((Get-Date) -lt $deadline)

throw "Stockfish remote service did not become healthy within 30 seconds."
