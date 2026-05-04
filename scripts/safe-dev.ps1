param(
  [switch]$SkipBackup,
  [switch]$FullBackup
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sharedData = Join-Path $env:APPDATA "org.encroissant.app"
$backupRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "EnCroissantDataBackups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupRoot "org.encroissant.app-before-fork-dev-$timestamp"

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

if (-not $SkipBackup) {
  New-Item -ItemType Directory -Force -Path $backupPath | Out-Null

  if ($FullBackup) {
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

  Write-Host "Backed up shared En Croissant data to $backupPath"
}

Set-Location $repoRoot
pnpm dev
