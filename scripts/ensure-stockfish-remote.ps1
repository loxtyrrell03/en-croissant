param(
  [string]$TaskName = "Stockfish18Remote",
  [string]$TaskPath = "\EnCroissant\",
  [string]$HealthUrl = "http://127.0.0.1:38419/v1/health"
)

$ErrorActionPreference = "Stop"

function Set-BackgroundChessBenchmarkPriority {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $benchmarkProcesses = @($processes | Where-Object { $_.Name -eq "fastchess.exe" })
  if ($benchmarkProcesses.Count -eq 0) {
    return
  }

  $benchmarkProcessIds = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($process in $benchmarkProcesses) {
    [void]$benchmarkProcessIds.Add([int]$process.ProcessId)
  }

  # Include engines and SSH relays already launched by FastChess. New children
  # inherit Idle priority from their demoted parent after this repair runs.
  do {
    $foundDescendant = $false
    foreach ($process in $processes) {
      if (
        $benchmarkProcessIds.Contains([int]$process.ParentProcessId) -and
        $benchmarkProcessIds.Add([int]$process.ProcessId)
      ) {
        $foundDescendant = $true
      }
    }
  } while ($foundDescendant)

  foreach ($processId in $benchmarkProcessIds) {
    try {
      # The gaming PC is also the interactive phone host. Benchmarks may use
      # otherwise-idle CPU, but must always yield to the proxy, Tailscale, and
      # the shared phone engine.
      (Get-Process -Id $processId -ErrorAction Stop).PriorityClass = "Idle"
    } catch {
      # A match process may exit between discovery and priority repair.
    }
  }
}

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
  $serverProcessIds = @($serverProcesses.ProcessId)
  foreach ($processId in $serverProcessIds) {
    try {
      (Get-Process -Id $processId -ErrorAction Stop).PriorityClass = "High"
    } catch {
      # A process may exit between discovery and priority repair.
    }
  }
  if ($serverProcessIds.Count -gt 0) {
    $engineProcessIds = @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ParentProcessId -in $serverProcessIds -and $_.Name -like "stockfish*.exe"
      } | Select-Object -ExpandProperty ProcessId
    )
    foreach ($processId in $engineProcessIds) {
      try {
        # Above Normal retains nearly all engine throughput without starving
        # the phone proxy and Tailscale stream while all 16 threads are busy.
        (Get-Process -Id $processId -ErrorAction Stop).PriorityClass = "AboveNormal"
      } catch {
        # A process may exit between discovery and priority repair.
      }
    }
  }
}

Set-BackgroundChessBenchmarkPriority
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
