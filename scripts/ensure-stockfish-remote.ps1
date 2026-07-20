param(
  [string]$TaskName = "Stockfish18Remote",
  [string]$TaskPath = "\EnCroissant\",
  [string]$HealthUrl = "http://127.0.0.1:38419/v1/health"
)

$ErrorActionPreference = "Stop"

function Set-RemoteTaskPriority {
  try {
    $remoteTask = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
    if ([int]$remoteTask.Settings.Priority -ne 4) {
      $remoteTask.Settings.Priority = 4
      Set-ScheduledTask -InputObject $remoteTask | Out-Null
    }
  } catch {
    # Process priority repair below still protects an already-running service.
  }
}

function Set-RemoteProcessPriority {
  $serverProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "node.exe" -and [string]$_.CommandLine -like "*stockfish-remote-server.mjs*"
  }
  $processIds = @($serverProcesses.ProcessId)
  if ($processIds.Count -gt 0) {
    $processIds += @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ParentProcessId -in $processIds -and $_.Name -like "stockfish*.exe"
      } | Select-Object -ExpandProperty ProcessId
    )
  }
  foreach ($processId in $processIds) {
    try {
      (Get-Process -Id $processId -ErrorAction Stop).PriorityClass = "High"
    } catch {
      # A process may exit between discovery and priority repair.
    }
  }
}

Set-RemoteTaskPriority

try {
  $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
  if (
    $health.ok -and
    $health.service -eq "stockfish-18-remote" -and
    [int]$health.queuedAnalyses -le 2
  ) {
    Set-RemoteProcessPriority
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
      Set-RemoteProcessPriority
      exit 0
    }
  } catch {
  }
} while ((Get-Date) -lt $deadline)

throw "Stockfish remote service did not become healthy within 30 seconds."
