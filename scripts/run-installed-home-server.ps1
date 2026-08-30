param(
  [int]$Port = 8787,
  [switch]$ForceRestart,
  [string]$ServerRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ServerRoot) {
  $ServerRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
}
$ServerRoot = [IO.Path]::GetFullPath($ServerRoot)
$pidPath = Join-Path $ServerRoot 'home-server.pid'
$stdoutPath = Join-Path $ServerRoot 'stdout.log'
$stderrPath = Join-Path $ServerRoot 'stderr.log'
$runtimeRoot = Join-Path $ServerRoot 'runtime'
$deploymentPath = Join-Path $ServerRoot 'runtime-deployment.json'
$serverScript = Join-Path $runtimeRoot 'home-server.mjs'
$node = Join-Path $runtimeRoot 'node.exe'
$healthUrl = "http://127.0.0.1:$Port/api/health"

if (-not (Test-Path -LiteralPath $deploymentPath -PathType Leaf)) {
  throw "The installed home-server runtime has no deployment identity at $deploymentPath."
}
$deployment = Get-Content -Raw -LiteralPath $deploymentPath | ConvertFrom-Json
$repoRoot = [string]$deployment.repoRoot
if (-not $repoRoot -or -not [IO.Path]::IsPathRooted($repoRoot)) {
  throw 'The installed home-server runtime has an invalid repository root.'
}
$repoRoot = [IO.Path]::GetFullPath($repoRoot)
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
  throw "The installed home-server entrypoint is missing at $serverScript."
}
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw 'The bundled Node.js runtime is missing. Re-run install-home-server.ps1.'
}

function Test-EnCroissantHomeServerProcess {
  param($Process)

  if (-not $Process) { return $false }
  return [string]$Process.CommandLine -like "*$serverScript*"
}

function Stop-EnCroissantHomeServerTree {
  param($Process)

  if (-not (Test-EnCroissantHomeServerProcess $Process)) {
    throw "Refusing to stop a process that is not the installed home server: $($Process.CommandLine)"
  }
  & taskkill.exe /PID ([int]$Process.ProcessId) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $remaining = Get-CimInstance Win32_Process `
      -Filter "ProcessId=$($Process.ProcessId)" `
      -ErrorAction SilentlyContinue
    if ($remaining) {
      throw "Could not stop the installed home-server process tree $($Process.ProcessId)."
    }
  }
  Wait-Process -Id ([int]$Process.ProcessId) -Timeout 5 -ErrorAction SilentlyContinue
}

if (-not $ForceRestart) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok) {
      $healthyProcess = Get-CimInstance Win32_Process `
        -Filter "ProcessId=$([int]$health.pid)" `
        -ErrorAction SilentlyContinue
      if (Test-EnCroissantHomeServerProcess $healthyProcess) {
        exit 0
      }
    }
  } catch {
  }
}

if (Test-Path -LiteralPath $pidPath) {
  $oldPid = [int](Get-Content -Raw -LiteralPath $pidPath)
  $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -ErrorAction SilentlyContinue
  if (Test-EnCroissantHomeServerProcess $oldProcess) {
    Stop-EnCroissantHomeServerTree $oldProcess
  }
}

if ($ForceRestart) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process `
      -Filter "ProcessId=$($listener.OwningProcess)" `
      -ErrorAction SilentlyContinue
    if (-not $listenerProcess) { continue }
    if (-not (Test-EnCroissantHomeServerProcess $listenerProcess)) {
      throw "Port $Port is already owned by another process: $($listenerProcess.CommandLine)"
    }
    Stop-EnCroissantHomeServerTree $listenerProcess
  }
}

$env:EN_CROISSANT_HOME_SERVER_PORT = [string]$Port
$env:EN_CROISSANT_REPO_ROOT = $repoRoot
if (-not $env:EN_CROISSANT_COACH_COMMAND) {
  $installedCoach = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($installedCoach) {
    $runtimeCoach = Join-Path $runtimeRoot 'codex.exe'
    $temporaryCoach = "$runtimeCoach.next-$PID"
    Copy-Item -LiteralPath $installedCoach.Source -Destination $temporaryCoach -Force
    Move-Item -LiteralPath $temporaryCoach -Destination $runtimeCoach -Force
    $env:EN_CROISSANT_COACH_COMMAND = $runtimeCoach
  }
}

$process = Start-Process -FilePath $node `
  -ArgumentList "`"$serverScript`"" `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

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
