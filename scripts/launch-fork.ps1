$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $repoRoot "src-tauri"
$debugExe = Join-Path $srcTauri "target\debug\en-croissant-fork.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$port = 1420

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not ([System.Management.Automation.PSTypeName]"NativeErrorMode").Type) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativeErrorMode {
  [DllImport("kernel32.dll")]
  public static extern UInt32 SetErrorMode(UInt32 uMode);
}
"@
}

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

function Get-RepoViteProcesses {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  }
  catch {
    return @()
  }

  $processes = @()
  foreach ($ownerId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }

    $commandLine = [string]$process.CommandLine
    $isRepoCommand = $commandLine.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isViteCommand = $commandLine.IndexOf("vite", [StringComparison]::OrdinalIgnoreCase) -ge 0

    if ($process.Name -eq "node.exe" -and $isRepoCommand -and $isViteCommand) {
      $processes += $process
    }
  }

  return $processes
}

function Stop-RepoViteProcesses {
  param([string]$Reason)

  foreach ($process in Get-RepoViteProcesses) {
    Write-LaunchLog "$Reason Vite process $($process.ProcessId) on port $port."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Assert-DevPortAvailable {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  }
  catch {
    return
  }

  foreach ($ownerId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
    if ($process) {
      throw "Port $port is already in use by $($process.Name) ($ownerId): $($process.CommandLine)"
    }
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
  Stop-RepoViteProcesses "Stopping stale"
  Assert-DevPortAvailable

  if (Test-DevServerListening) {
    Write-LaunchLog "Vite dev server is already listening on port $port."
    return $null
  }

  $pnpm = Get-PnpmCommand
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logDir "vite-$timestamp.out.log"
  $stderr = Join-Path $logDir "vite-$timestamp.err.log"

  Write-LaunchLog "Starting Vite dev server with $pnpm."
  $process = Start-Process -FilePath "cmd.exe" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Minimized `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -ArgumentList @(
      "/d",
      "/s",
      "/c",
      "`"$pnpm`" start-vite"
    ) `
    -PassThru

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-DevServerListening) {
      Write-LaunchLog "Vite dev server is ready."
      return $process
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

function Format-ExitCode {
  param([int]$ExitCode)

  return "0x{0:X8}" -f ([uint32]$ExitCode)
}

function Remove-DebugBinary {
  $debugFiles = @(
    $debugExe,
    (Join-Path $srcTauri "target\debug\en-croissant-fork.d"),
    (Join-Path $srcTauri "target\debug\en_croissant_fork.pdb")
  )

  foreach ($path in $debugFiles) {
    if (Test-Path $path) {
      Remove-Item -LiteralPath $path -Force
      Write-LaunchLog "Removed stale debug artifact $path."
    }
  }
}

function Start-ForkBinary {
  Write-LaunchLog "Starting fork binary $debugExe."

  # Inherit a quiet error mode so loader failures become exit codes that the
  # launcher can repair instead of raw Windows Application Error popups.
  $previousErrorMode = [NativeErrorMode]::SetErrorMode(0x8003)

  try {
    $process = Start-Process -FilePath $debugExe -WorkingDirectory $srcTauri -PassThru
  }
  finally {
    [NativeErrorMode]::SetErrorMode($previousErrorMode) | Out-Null
  }

  Start-Sleep -Seconds 4
  $process.Refresh()

  if ($process.HasExited) {
    $exitCode = Format-ExitCode $process.ExitCode
    throw "Fork binary exited during startup with code $exitCode."
  }

  Write-LaunchLog "Fork process $($process.Id) is running."
  return $process
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
    $devServerProcess = Start-DevServer
    try {
      $forkProcess = Start-ForkBinary
    }
    catch {
      Write-LaunchLog "Prebuilt debug binary launch failed: $($_.Exception.Message)"
      Stop-RepoViteProcesses "Cleaning up after failed fork launch"
      Remove-DebugBinary
      Start-SafeDevFallback
      exit 0
    }

    try {
      Wait-Process -Id $forkProcess.Id
    }
    finally {
      Stop-RepoViteProcesses "Cleaning up after fork exit"
      if ($devServerProcess -and -not $devServerProcess.HasExited) {
        Stop-Process -Id $devServerProcess.Id -Force -ErrorAction SilentlyContinue
      }
    }
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
