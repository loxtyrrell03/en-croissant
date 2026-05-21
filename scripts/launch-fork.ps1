$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $repoRoot "src-tauri"
$debugExe = Join-Path $srcTauri "target\debug\en-croissant-fork.exe"
$logDir = Join-Path $PSScriptRoot "logs"
$port = 1420
$launchMutexName = "Local\EnCroissantForkLaunch"
$devSessionMutexName = "Local\EnCroissantForkDevSession"
$launchMutex = $null
$launchMutexAcquired = $false
$devSessionMutex = $null
$devSessionMutexAcquired = $false

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

function Release-LaunchMutex {
  if ($script:launchMutexAcquired -and $script:launchMutex) {
    try {
      $script:launchMutex.ReleaseMutex() | Out-Null
    }
    catch {
    }
    $script:launchMutexAcquired = $false
  }

  if ($script:launchMutex) {
    $script:launchMutex.Dispose()
    $script:launchMutex = $null
  }
}

function Release-DevSessionMutex {
  if ($script:devSessionMutexAcquired -and $script:devSessionMutex) {
    try {
      $script:devSessionMutex.ReleaseMutex() | Out-Null
    }
    catch {
    }
    $script:devSessionMutexAcquired = $false
  }

  if ($script:devSessionMutex) {
    $script:devSessionMutex.Dispose()
    $script:devSessionMutex = $null
  }
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

function Test-FrontendDependenciesPresent {
  $modulesFile = Join-Path $repoRoot "node_modules\.modules.yaml"
  $viteCmd = Join-Path $repoRoot "node_modules\.bin\vite.cmd"
  $tauriCmd = Join-Path $repoRoot "node_modules\.bin\tauri.cmd"

  return (Test-Path $modulesFile) -and (Test-Path $viteCmd) -and (Test-Path $tauriCmd)
}

function Ensure-FrontendDependencies {
  if (Test-FrontendDependenciesPresent) {
    return
  }

  $pnpm = Get-PnpmCommand
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $stdout = Join-Path $logDir "pnpm-install-$timestamp.out.log"
  $stderr = Join-Path $logDir "pnpm-install-$timestamp.err.log"

  Write-LaunchLog "Frontend dependencies are missing; running pnpm install --frozen-lockfile."
  $process = Start-Process -FilePath "cmd.exe" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Minimized `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -ArgumentList @(
      "/d",
      "/s",
      "/c",
      "`"$pnpm`" install --frozen-lockfile"
    ) `
    -PassThru `
    -Wait

  if ($process.ExitCode -ne 0) {
    throw "pnpm install failed with exit code $(Format-ExitCode $process.ExitCode). See $stdout and $stderr."
  }

  if (-not (Test-FrontendDependenciesPresent)) {
    throw "pnpm install completed, but required frontend tools are still missing. See $stdout and $stderr."
  }

  Write-LaunchLog "Frontend dependencies are ready."
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
    if ($process.ExitCode -eq 0) {
      Write-LaunchLog "Fork binary exited during startup with code $exitCode; another instance probably handled activation."
      return $null
    }
    throw "Fork binary exited during startup with code $exitCode."
  }

  Write-LaunchLog "Fork process $($process.Id) is running."
  return $process
}

try {
  $launchMutex = New-Object System.Threading.Mutex($false, $launchMutexName)
  $launchMutexAcquired = $launchMutex.WaitOne([TimeSpan]::FromSeconds(60))
  if (-not $launchMutexAcquired) {
    throw "Another En Croissant Fork launch is still starting. Please try again in a moment."
  }

  $runningFork = Get-Process -Name "en-croissant-fork" -ErrorAction SilentlyContinue | Select-Object -First 1

  if ($runningFork) {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.AppActivate($runningFork.Id)
    Write-LaunchLog "Activated existing fork process $($runningFork.Id)."
    Release-LaunchMutex
    exit 0
  }

  Ensure-FrontendDependencies

  if (Test-DebugBinaryFresh) {
    $devSessionMutex = New-Object System.Threading.Mutex($false, $devSessionMutexName)
    $devSessionMutexAcquired = $devSessionMutex.WaitOne(0)
    if (-not $devSessionMutexAcquired) {
      $runningFork = Get-Process -Name "en-croissant-fork" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($runningFork) {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.AppActivate($runningFork.Id)
        Write-LaunchLog "Activated existing fork process $($runningFork.Id) while a dev session was already active."
        Release-LaunchMutex
        exit 0
      }

      throw "Another En Croissant Fork dev session is already starting or running."
    }

    $devServerProcess = Start-DevServer
    try {
      $forkProcess = Start-ForkBinary
    }
    catch {
      Write-LaunchLog "Prebuilt debug binary launch failed: $($_.Exception.Message)"
      Stop-RepoViteProcesses "Cleaning up after failed fork launch"
      Release-DevSessionMutex
      Remove-DebugBinary
      Start-SafeDevFallback
      Release-LaunchMutex
      exit 0
    }

    Release-LaunchMutex

    if (-not $forkProcess) {
      $runningFork = Get-Process -Name "en-croissant-fork" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($runningFork) {
        try {
          Wait-Process -Id $runningFork.Id
        }
        finally {
          Stop-RepoViteProcesses "Cleaning up after activated fork exit"
          if ($devServerProcess -and -not $devServerProcess.HasExited) {
            Stop-Process -Id $devServerProcess.Id -Force -ErrorAction SilentlyContinue
          }
          Release-DevSessionMutex
        }
      }
      else {
        Stop-RepoViteProcesses "Cleaning up after clean fork startup exit"
        if ($devServerProcess -and -not $devServerProcess.HasExited) {
          Stop-Process -Id $devServerProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Release-DevSessionMutex
      }
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
      Release-DevSessionMutex
    }
    exit 0
  }

  Start-SafeDevFallback
  Release-LaunchMutex
}
catch {
  Write-LaunchLog "Launch failed: $($_.Exception.Message)"
  Release-LaunchMutex
  Release-DevSessionMutex

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Could not start En Croissant Fork.`n`n$($_.Exception.Message)`n`nLog: $(Join-Path $logDir "launch-fork.log")",
    "En Croissant Fork",
    "OK",
    "Error"
  ) | Out-Null

  exit 1
}
