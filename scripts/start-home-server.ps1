param(
  [int]$Port = 8787,
  [switch]$ForceRestart,
  [switch]$StageOnly
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
$sourceCommit = $null
if ($gitCommand) {
  $gitCommonDirectory = (& $gitExe -C $repoRoot rev-parse --path-format=absolute --git-common-dir).Trim()
  if ($LASTEXITCODE -eq 0 -and $gitCommonDirectory) {
    $canonicalRepoRoot = Split-Path -Parent $gitCommonDirectory
    $sourceCommit = (& $gitExe -C $repoRoot rev-parse HEAD).Trim()
  }
}
if (-not $canonicalRepoRoot) {
  $canonicalRepoRoot = $repoRoot
}

$serverRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$runtimeRoot = Join-Path $serverRoot 'runtime'
$runtimeGeneratedRoot = Join-Path $runtimeRoot 'generated'
$launcherRoot = Join-Path $serverRoot 'launcher'
$installedLauncher = Join-Path $launcherRoot 'run-installed-home-server.ps1'
$deploymentPath = Join-Path $serverRoot 'runtime-deployment.json'
$sourceStatsWorkerRoot = Join-Path $PSScriptRoot 'generated'
$sourceLauncher = Join-Path $PSScriptRoot 'run-installed-home-server.ps1'

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeGeneratedRoot -Force | Out-Null
New-Item -ItemType Directory -Path $launcherRoot -Force | Out-Null

$runtimeFiles = @(
  'home-server.mjs',
  'home-library-index.mjs',
  'chess-coach-service.mjs',
  'chess-coach-derived.mjs',
  'lichess-local-eval-reader.mjs',
  'otb-import-service.mjs',
  'otb-prep-parallel.mjs',
  'otb-prep-worker.mjs',
  'terminate-collector-process-tree.ps1',
  'fide-player-search.mjs'
)
# Resolve and validate the complete import graph before staging or restarting.
# A new relative import must not silently be omitted from the installed runtime.
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$runtimeNode = if ($nodeCommand) { $nodeCommand.Source } else {
  'C:\Users\Lox\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
$runtimeFiles = @(& $runtimeNode (Join-Path $PSScriptRoot 'home-server-runtime-files.mjs') $PSScriptRoot @runtimeFiles)
if ($LASTEXITCODE -ne 0) { throw 'The home-server runtime dependency check failed before restart.' }
foreach ($fileName in $runtimeFiles) {
  $source = Join-Path $PSScriptRoot $fileName
  $destination = Join-Path $runtimeRoot $fileName
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  $temporary = "$destination.next-$PID"
  Copy-Item -LiteralPath $source -Destination $temporary -Force
  Move-Item -LiteralPath $temporary -Destination $destination -Force
}

if (Test-Path -LiteralPath $sourceStatsWorkerRoot) {
  Get-ChildItem -LiteralPath $sourceStatsWorkerRoot -File | ForEach-Object {
    foreach ($destinationRoot in @($runtimeRoot, $runtimeGeneratedRoot)) {
      $destination = Join-Path $destinationRoot $_.Name
      $temporary = "$destination.next-$PID"
      Copy-Item -LiteralPath $_.FullName -Destination $temporary -Force
      Move-Item -LiteralPath $temporary -Destination $destination -Force
    }
  }
}

$temporaryLauncher = "$installedLauncher.next-$PID"
Copy-Item -LiteralPath $sourceLauncher -Destination $temporaryLauncher -Force
Move-Item -LiteralPath $temporaryLauncher -Destination $installedLauncher -Force

$deployment = [ordered]@{
  schemaVersion = 1
  sourceCommit = $sourceCommit
  repoRoot = $canonicalRepoRoot
  stagedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$temporaryDeployment = "$deploymentPath.next-$PID"
$deployment | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $temporaryDeployment -Encoding utf8
Move-Item -LiteralPath $temporaryDeployment -Destination $deploymentPath -Force

if ($StageOnly) {
  exit 0
}

$arguments = @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $installedLauncher,
  '-Port',
  [string]$Port,
  '-ServerRoot',
  $serverRoot
)
if ($ForceRestart) {
  $arguments += '-ForceRestart'
}
& powershell.exe @arguments
exit $LASTEXITCODE
