param(
  [switch]$SkipBackup,
  [switch]$FullBackup,
  [switch]$AllowLargeFullBackup,
  [switch]$CleanupBackupsOnly,
  [switch]$CleanupAgentScratchOnly,
  [int]$MaxBackups = 3,
  [int]$MaxBackupTotalGb = 10,
  [int]$FullBackupLimitGb = 2,
  [int]$MaxReviewSidecarMb = 50,
  [int]$AgentScratchMinAgeHours = 2
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sharedData = Join-Path $env:APPDATA "org.encroissant.app"
$backupRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "EnCroissantDataBackups"
$backupPrefix = "org.encroissant.app-before-fork-dev-"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupRoot "$backupPrefix$timestamp"
$devPort = 1420
$devSessionMutexName = "Local\EnCroissantForkDevSession"
$devSessionMutex = $null
$devSessionMutexAcquired = $false

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

function Get-RepoViteProcesses {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue
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
    Write-Host "$Reason Vite process $($process.ProcessId) on port $devPort."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Assert-DevPortAvailable {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue
  }
  catch {
    return
  }

  foreach ($ownerId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction SilentlyContinue
    if ($process) {
      throw "Port $devPort is already in use by $($process.Name) ($ownerId): $($process.CommandLine)"
    }
  }
}

function Invoke-RobocopyChecked {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$Arguments
  )

  robocopy $Source $Destination @Arguments | Out-Host
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to back up shared data from $Source to $Destination"
  }
}

function Get-DirectorySizeBytes {
  param([string]$Path)

  $total = [int64]0
  $stack = New-Object "System.Collections.Generic.Stack[string]"
  $stack.Push($Path)

  while ($stack.Count -gt 0) {
    $dir = $stack.Pop()

    try {
      foreach ($file in [System.IO.Directory]::EnumerateFiles($dir)) {
        try {
          $fileInfo = [System.IO.FileInfo]$file
          if (($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
            $total += $fileInfo.Length
          }
        }
        catch {
        }
      }

      foreach ($subdir in [System.IO.Directory]::EnumerateDirectories($dir)) {
        try {
          $dirInfo = [System.IO.DirectoryInfo]$subdir
          if (($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
            $stack.Push($subdir)
          }
        }
        catch {
        }
      }
    }
    catch {
    }
  }

  return $total
}

function Remove-EmptyDirectory {
  param([string]$Path)

  if ((Test-Path $Path) -and -not (Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Remove-Item -LiteralPath $Path -Recurse -Force
    Write-Host "Removed empty backup folder $Path"
  }
}

function Remove-OldBackups {
  param(
    [int]$Keep,
    [int]$MaxTotalGb
  )

  if ($Keep -lt 1 -or -not (Test-Path $backupRoot)) {
    return
  }

  $backups = @(Get-ChildItem -LiteralPath $backupRoot -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name.StartsWith($backupPrefix) } |
    Sort-Object LastWriteTime -Descending)

  $maxTotalBytes = [int64]$MaxTotalGb * 1GB
  $keptCount = 0
  $keptBytes = [int64]0

  foreach ($backup in $backups) {
    $backupBytes = Get-DirectorySizeBytes $backup.FullName
    $isNewest = $keptCount -eq 0
    $fitsCount = $keptCount -lt $Keep
    $fitsSize = $MaxTotalGb -le 0 -or ($keptBytes + $backupBytes) -le $maxTotalBytes

    if ($isNewest -or ($fitsCount -and $fitsSize)) {
      $keptCount++
      $keptBytes += $backupBytes
      continue
    }

    Remove-Item -LiteralPath $backup.FullName -Recurse -Force
    Write-Host "Pruned old En Croissant dev backup $($backup.FullName) ($([math]::Round($backupBytes / 1GB, 2)) GB)"
  }
}

function Remove-OldAgentScratchFiles {
  param([int]$MinAgeHours)

  $cutoff = (Get-Date).AddHours(-1 * [math]::Max($MinAgeHours, 1))
  $repoTempToken = $repoRoot -replace '[:\\ ]', '-'
  $claudeRepoTemp = Join-Path (Join-Path $env:TEMP "claude") $repoTempToken
  $allowedRoots = @($claudeRepoTemp, $env:TEMP)
  $candidates = @()

  if (Test-Path $claudeRepoTemp) {
    $candidates += Get-ChildItem -LiteralPath $claudeRepoTemp -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Length -ge 100MB -and
        $_.LastWriteTime -lt $cutoff -and
        ($_.Name -match '\.sqlite(?:\.bak)?$' -or $_.Name -match '\.bak$')
      }
  }

  $candidates += Get-ChildItem -LiteralPath $env:TEMP -File -Force -Filter "probe_db_*.sqlite" -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -ge 100MB -and $_.LastWriteTime -lt $cutoff }

  $removedBytes = [int64]0
  foreach ($candidate in ($candidates | Sort-Object FullName -Unique)) {
    $resolved = $candidate.FullName
    $insideAllowedRoot = $false
    foreach ($allowedRoot in $allowedRoots) {
      if ($resolved.StartsWith($allowedRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $insideAllowedRoot = $true
        break
      }
    }

    if (-not $insideAllowedRoot) {
      throw "Refusing to remove unexpected scratch file $resolved"
    }

    $removedBytes += $candidate.Length
    Remove-Item -LiteralPath $resolved -Force
    Write-Host "Removed stale agent scratch file $resolved"
  }

  Write-Host "Removed $([math]::Round($removedBytes / 1GB, 2)) GB of stale agent scratch files."
}

if ($CleanupBackupsOnly) {
  Remove-OldBackups -Keep $MaxBackups -MaxTotalGb $MaxBackupTotalGb
  exit 0
}

if ($CleanupAgentScratchOnly) {
  Remove-OldAgentScratchFiles -MinAgeHours $AgentScratchMinAgeHours
  exit 0
}

if (-not $SkipBackup -and -not (Test-Path $sharedData)) {
  throw "Could not find En Croissant data at $sharedData"
}

$devSessionMutex = New-Object System.Threading.Mutex($false, $devSessionMutexName)
$devSessionMutexAcquired = $devSessionMutex.WaitOne(0)
if (-not $devSessionMutexAcquired) {
  Write-Host "An En Croissant Fork dev session is already starting or running. Use the existing app window."
  exit 0
}

if (-not $SkipBackup) {
  New-Item -ItemType Directory -Force -Path $backupPath | Out-Null

  if ($FullBackup) {
    $sourceSizeGb = [math]::Round((Get-DirectorySizeBytes $sharedData) / 1GB, 2)
    if (-not $AllowLargeFullBackup -and $sourceSizeGb -gt $FullBackupLimitGb) {
      Remove-EmptyDirectory $backupPath
      throw "Refusing to create a $sourceSizeGb GB full backup of $sharedData. This launcher keeps backups compact by default to avoid filling C:. Re-run with -FullBackup -AllowLargeFullBackup only if you intentionally want a full database copy."
    }

    Write-Host "Creating full En Croissant data backup. This can take a while for large databases."
    Invoke-RobocopyChecked $sharedData $backupPath @("/E", "/XJ", "/R:2", "/W:2", "/NFL", "/NDL", "/NP")
  }
  else {
    $dbDir = Join-Path $sharedData "db"
    $puzzlesDir = Join-Path $sharedData "puzzles"
    $enginesDir = Join-Path $sharedData "engines"
    $localEvalsDir = Join-Path $sharedData "lichess-cloud-evals"
    $backupDbDir = Join-Path $backupPath "db"

    Write-Host "Creating fast En Croissant data backup."
    Write-Host "Skipping heavyweight database, puzzle, and engine files so the app can launch quickly."
    Write-Host "Run scripts/safe-dev.ps1 -FullBackup when you want a complete multi-GB backup."

    Invoke-RobocopyChecked $sharedData $backupPath @(
      "/E",
      "/XJ",
      "/R:2",
      "/W:2",
      "/NFL",
      "/NDL",
      "/NP",
      "/XD",
      $dbDir,
      $puzzlesDir,
      $enginesDir,
      $localEvalsDir
    )

    if (Test-Path $dbDir) {
      New-Item -ItemType Directory -Force -Path $backupDbDir | Out-Null
      $maxReviewSidecarBytes = [int64]$MaxReviewSidecarMb * 1MB
      Invoke-RobocopyChecked $dbDir $backupDbDir @(
        "*.opening-review.json",
        "*.mistake-review.json",
        "/MAX:$maxReviewSidecarBytes",
        "/R:2",
        "/W:2",
        "/NFL",
        "/NDL",
        "/NP"
      )
    }
  }

  Remove-EmptyDirectory $backupPath

  if (Test-Path $backupPath) {
    Write-Host "Backed up shared En Croissant data to $backupPath"
  }

  Remove-OldBackups -Keep $MaxBackups -MaxTotalGb $MaxBackupTotalGb
}

Set-Location $repoRoot
Stop-RepoViteProcesses "Stopping stale"
Assert-DevPortAvailable

$devExitCode = 0
try {
  npm run dev:tauri
  $devExitCode = $LASTEXITCODE
}
finally {
  Stop-RepoViteProcesses "Cleaning up"
  Release-DevSessionMutex
}

exit $devExitCode
