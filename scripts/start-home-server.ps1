param(
  [int]$Port = 8787,
  [switch]$ForceRestart
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  $bundledGit = 'C:\Users\Lox\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
  if (Test-Path -LiteralPath $bundledGit) {
    $gitCommand = Get-Item -LiteralPath $bundledGit
  }
}
$gitExe = if ($gitCommand -is [System.Management.Automation.ApplicationInfo]) {
  $gitCommand.Source
} elseif ($gitCommand) {
  $gitCommand.FullName
}
if ($gitCommand) {
  $gitCommonDirectory = (& $gitExe -C $repoRoot rev-parse --path-format=absolute --git-common-dir).Trim()
}
if ($gitCommand -and $LASTEXITCODE -eq 0 -and $gitCommonDirectory) {
  $canonicalRepoRoot = Split-Path -Parent $gitCommonDirectory
} else {
  $canonicalRepoRoot = $repoRoot
}
$serverRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$pidPath = Join-Path $serverRoot 'home-server.pid'
$stdoutPath = Join-Path $serverRoot 'stdout.log'
$stderrPath = Join-Path $serverRoot 'stderr.log'
$runtimeRoot = Join-Path $serverRoot 'runtime'
$serverScript = Join-Path $runtimeRoot 'home-server.mjs'
$sourceServerScript = Join-Path $PSScriptRoot 'home-server.mjs'
$sourceLibraryIndex = Join-Path $PSScriptRoot 'home-library-index.mjs'
$sourceChessCoachService = Join-Path $PSScriptRoot 'chess-coach-service.mjs'
$sourceChessCoachDerived = Join-Path $PSScriptRoot 'chess-coach-derived.mjs'
$sourceOtbImportService = Join-Path $PSScriptRoot 'otb-import-service.mjs'
$sourceStatsWorkerRoot = Join-Path $PSScriptRoot 'generated'
$node = Join-Path $runtimeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $node = $nodeCommand.Source
  } else {
    throw 'The bundled Node.js runtime is missing. Re-run install-home-server.ps1.'
  }
}
$healthUrl = "http://127.0.0.1:$Port/api/health"

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

foreach ($runtimeFile in @(
  @{ Source = $sourceServerScript; Destination = $serverScript },
  @{ Source = $sourceLibraryIndex; Destination = (Join-Path $runtimeRoot 'home-library-index.mjs') },
  @{ Source = $sourceChessCoachService; Destination = (Join-Path $runtimeRoot 'chess-coach-service.mjs') },
  @{ Source = $sourceChessCoachDerived; Destination = (Join-Path $runtimeRoot 'chess-coach-derived.mjs') }
  @{ Source = $sourceOtbImportService; Destination = (Join-Path $runtimeRoot 'otb-import-service.mjs') }
)) {
  $temporaryRuntimeFile = "$($runtimeFile.Destination).next-$PID"
  Copy-Item -LiteralPath $runtimeFile.Source -Destination $temporaryRuntimeFile -Force
  Move-Item -LiteralPath $temporaryRuntimeFile -Destination $runtimeFile.Destination -Force
}

if (Test-Path -LiteralPath $sourceStatsWorkerRoot) {
  Get-ChildItem -LiteralPath $sourceStatsWorkerRoot -File | ForEach-Object {
    $destination = Join-Path $runtimeRoot $_.Name
    $temporaryRuntimeFile = "$destination.next-$PID"
    Copy-Item -LiteralPath $_.FullName -Destination $temporaryRuntimeFile -Force
    Move-Item -LiteralPath $temporaryRuntimeFile -Destination $destination -Force
  }
}

function Test-EnCroissantHomeServerProcess {
  param($Process)

  if (-not $Process) { return $false }
  $commandLine = [string]$Process.CommandLine
  return $commandLine -like "*$serverScript*" -or $commandLine -like "*$sourceServerScript*"
}

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
  if (Test-EnCroissantHomeServerProcess $oldProcess) {
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
    if (-not (Test-EnCroissantHomeServerProcess $listenerProcess)) {
      throw "Port $Port is already owned by another process: $($listenerProcess.CommandLine)"
    }
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $listener.OwningProcess -Timeout 5 -ErrorAction SilentlyContinue
  }
}

$env:EN_CROISSANT_HOME_SERVER_PORT = [string]$Port
$env:EN_CROISSANT_REPO_ROOT = $canonicalRepoRoot
if (-not $env:EN_CROISSANT_COACH_COMMAND) {
  $installedCoach = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($installedCoach) {
    # Windows Store app package executables cannot be launched directly by the
    # background service account. Codex CLI is standalone, so keep an executable
    # runtime copy beside node.exe and refresh it when the app updates.
    $runtimeCoach = Join-Path $runtimeRoot 'codex.exe'
    $temporaryCoach = "$runtimeCoach.next-$PID"
    Copy-Item -LiteralPath $installedCoach.Source -Destination $temporaryCoach -Force
    Move-Item -LiteralPath $temporaryCoach -Destination $runtimeCoach -Force
    $env:EN_CROISSANT_COACH_COMMAND = $runtimeCoach
  }
}
$process = Start-Process -FilePath $node `
  -ArgumentList "`"$serverScript`"" `
  -WorkingDirectory $canonicalRepoRoot `
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
