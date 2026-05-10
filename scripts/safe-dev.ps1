param(
  [switch]$SkipBackup,
  [switch]$FullBackup,
  [switch]$AllowLargeFullBackup,
  [int]$MaxBackups = 5,
  [int]$FullBackupLimitGb = 2
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sharedData = Join-Path $env:APPDATA "org.encroissant.app"
$backupRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "EnCroissantDataBackups"
$backupPrefix = "org.encroissant.app-before-fork-dev-"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupRoot "$backupPrefix$timestamp"

if (-not (Test-Path $sharedData)) {
  throw "Could not find En Croissant data at $sharedData"
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
  param([int]$Keep)

  if ($Keep -lt 1 -or -not (Test-Path $backupRoot)) {
    return
  }

  $oldBackups = Get-ChildItem -LiteralPath $backupRoot -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name.StartsWith($backupPrefix) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep

  foreach ($oldBackup in $oldBackups) {
    Remove-Item -LiteralPath $oldBackup.FullName -Recurse -Force
    Write-Host "Pruned old En Croissant dev backup $($oldBackup.FullName)"
  }
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
      $enginesDir
    )

    if (Test-Path $dbDir) {
      New-Item -ItemType Directory -Force -Path $backupDbDir | Out-Null
      Invoke-RobocopyChecked $dbDir $backupDbDir @(
        "*.opening-review.json",
        "*.mistake-review.json",
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

  Remove-OldBackups $MaxBackups
}

Set-Location $repoRoot
pnpm dev
