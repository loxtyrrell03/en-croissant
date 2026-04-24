param(
  [switch]$SkipBackup
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

if (-not $SkipBackup) {
  New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
  robocopy $sharedData $backupPath /E /R:2 /W:2 /NFL /NDL /NP | Out-Host
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to back up shared data to $backupPath"
  }

  Write-Host "Backed up shared En Croissant data to $backupPath"
}

Set-Location $repoRoot
pnpm dev
