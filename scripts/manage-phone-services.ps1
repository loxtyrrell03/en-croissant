param(
  [ValidateSet('Ensure', 'Stop')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ServerRoot,
  [int]$HomePort = 8787
)
$ErrorActionPreference = 'Stop'
$ServerRoot = [IO.Path]::GetFullPath($ServerRoot)
$homeScript = Join-Path $ServerRoot 'runtime\home-server.mjs'
$engineScript = Join-Path $env:LOCALAPPDATA 'Stockfish18Server\server\stockfish-remote-server.mjs'
$engineTask = Get-ScheduledTask -TaskName 'Stockfish18Remote' -TaskPath '\EnCroissant\'

if ($Action -eq 'Ensure') {
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
    (Join-Path $PSScriptRoot 'run-installed-home-server.ps1') -ServerRoot $ServerRoot -Port $HomePort
  if ($LASTEXITCODE -ne 0) { throw 'The phone and review server could not start.' }
  $ready = $false
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:38419/v1/health' -TimeoutSec 2
    $ready = $health.ok -and $health.service -eq 'stockfish-18-remote'
  } catch {}
  if (-not $ready) {
    # Do not stop a busy or still-starting engine service merely because a
    # health request timed out. The owned scheduled task handles child failure.
    Start-ScheduledTask -InputObject $engineTask
    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 300
      try {
        $health = Invoke-RestMethod 'http://127.0.0.1:38419/v1/health' -TimeoutSec 2
        if ($health.ok -and $health.service -eq 'stockfish-18-remote') { exit 0 }
      } catch {}
    } while ((Get-Date) -lt $deadline)
    throw 'The PC engine service could not start.'
  }
  exit 0
}

# A phone off choice is scoped to these installed process identities. Never
# terminate by port alone, by stale PID file, or by a broad node/engine name.
$processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
foreach ($process in $processes) {
  $command = [string]$process.CommandLine
  if ($command.Contains('"' + $homeScript + '"') -or $command.Contains('"' + $engineScript + '"')) {
    & taskkill.exe /PID ([int]$process.ProcessId) /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
      throw "Could not stop installed chess service $($process.ProcessId)."
    }
  }
}
# Stop the scheduler wrapper too, otherwise its failure recovery can defeat Off.
Stop-ScheduledTask -InputObject $engineTask
