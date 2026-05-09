$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $repoRoot "src-tauri"
$debugExe = Join-Path $srcTauri "target\debug\en-croissant-fork.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$port = 1420

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-LaunchLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path (Join-Path $logDir "launch-fork.log") -Value "[$timestamp] $Message"
}

function Get-PnpmCommand {
  $pnpmCmd = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  if ($pnpmCmd) {
    return $pnpmCmd.Source
  }

  $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
  if ($pnpm) {
    return $pnpm.Source
  }

  throw "Could not find pnpm on PATH."
}

function Test-DevServerListening {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  }
  catch {
    return $false
  }
}

function Test-DebugBinaryFresh {
  if (-not (Test-Path $debugExe)) {
    return $false
  }

  $binaryTime = (Get-Item $debugExe).LastWriteTimeUtc
  $backendInputs = @(
    (Join-Path $srcTauri "Cargo.toml"),
    (Join-Path $srcTauri "Cargo.lock"),
    (Join-Path $srcTauri "build.rs"),
    (Join-Path $srcTauri "tauri.conf.json")
  )

  foreach ($inputPath in $backendInputs) {
    if ((Test-Path $inputPath) -and (Get-Item $inputPath).LastWriteTimeUtc -gt $binaryTime) {
      return $false
    }
  }

  $newerSource = Get-ChildItem -Path (Join-Path $srcTauri "src") -Recurse -File |
    Where-Object { $_.LastWriteTimeUtc -gt $binaryTime } |
    Select-Object -First 1

  return -not $newerSource
}

function Start-DevServer {
  if (Test-DevServerListening) {
    Write-LaunchLog "Vite dev server is already listening on port $port."
    return
  }

  $pnpm = Get-PnpmCommand
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logDir "vite-$timestamp.out.log"
  $stderr = Join-Path $logDir "vite-$timestamp.err.log"

  Write-LaunchLog "Starting Vite dev server with $pnpm."
  Start-Process -FilePath "cmd.exe" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Minimized `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -ArgumentList @(
      "/d",
      "/s",
      "/c",
      "`"$pnpm`" start-vite"
    ) | Out-Null

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-DevServerListening) {
      Write-LaunchLog "Vite dev server is ready."
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for Vite on http://localhost:$port. See $stdout and $stderr."
}

function Start-SafeDevFallback {
  $pnpm = Get-PnpmCommand
  Write-LaunchLog "Debug binary is missing or stale; falling back to pnpm dev:safe."
  Start-Process -FilePath "cmd.exe" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Normal `
    -ArgumentList @(
      "/d",
      "/s",
      "/c",
      "`"$pnpm`" dev:safe"
    )
}

$runningFork = Get-Process -Name "en-croissant-fork" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($runningFork) {
  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.AppActivate($runningFork.Id)
  Write-LaunchLog "Activated existing fork process $($runningFork.Id)."
  exit 0
}

try {
  if (Test-DebugBinaryFresh) {
    Start-DevServer
    Write-LaunchLog "Starting fork binary $debugExe."
    Start-Process -FilePath $debugExe -WorkingDirectory $srcTauri
    exit 0
  }

  Start-SafeDevFallback
}
catch {
  Write-LaunchLog "Launch failed: $($_.Exception.Message)"

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Could not start En Croissant Fork.`n`n$($_.Exception.Message)`n`nLog: $(Join-Path $logDir "launch-fork.log")",
    "En Croissant Fork",
    "OK",
    "Error"
  ) | Out-Null

  exit 1
}
