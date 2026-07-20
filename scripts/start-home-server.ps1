param(
  [int]$Port = 8787,
  [switch]$ForceRestart
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$pidPath = Join-Path $serverRoot 'home-server.pid'
$stdoutPath = Join-Path $serverRoot 'stdout.log'
$stderrPath = Join-Path $serverRoot 'stderr.log'
$serverScript = Join-Path $PSScriptRoot 'home-server.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$healthUrl = "http://127.0.0.1:$Port/api/health"

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null

if (-not $ForceRestart) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok) {
      exit 0
    }
  } catch {
  }
}

if (Test-Path -LiteralPath $pidPath) {
  $oldPid = [int](Get-Content -Raw -LiteralPath $pidPath)
  $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -ErrorAction SilentlyContinue
  if ($oldProcess -and [string]$oldProcess.CommandLine -like "*$serverScript*") {
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $oldPid -Timeout 5 -ErrorAction SilentlyContinue
  }
}

if ($ForceRestart) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process `
      -Filter "ProcessId=$($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue
    if (-not $listenerProcess) {
      continue
    }
    if ([string]$listenerProcess.CommandLine -notlike "*$serverScript*") {
      throw "Port $Port is already owned by another process: $($listenerProcess.CommandLine)"
    }
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $listener.OwningProcess -Timeout 5 -ErrorAction SilentlyContinue
  }
}

$env:EN_CROISSANT_HOME_SERVER_PORT = [string]$Port
$process = Start-Process -FilePath $node `
  -ArgumentList "`"$serverScript`"" `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

# The phone proxy must be able to forward stream chunks and cancellations even
# while Stockfish occupies every logical processor.
$process.PriorityClass = 'Normal'

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    throw "Home server exited during startup. See $stderrPath"
  }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok -and [int]$health.pid -eq $process.Id) {
      exit 0
    }
  } catch {
  }
}

throw "Timed out waiting for the home server. See $stderrPath"
