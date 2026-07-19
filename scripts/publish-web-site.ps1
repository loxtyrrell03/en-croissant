param(
  [string]$SourceDir = "",
  [string]$PagesRepo = "",
  [string]$PagesRemote = "https://github.com/loxtyrrell03/loxtyrrell03.github.io.git",
  [string]$CommitMessage = "",
  [int]$MaxDatabaseMB = 200,
  [switch]$SkipDatabaseExports,
  [switch]$SkipBuild,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot "..")
$logRoot = Join-Path $env:LOCALAPPDATA "EnCroissantWebSync"
$logFile = Join-Path $logRoot "publish.log"

New-Item -Path $logRoot -ItemType Directory -Force | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

function Invoke-Logged {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Write-Log ("run: {0} {1}" -f $FilePath, ($Arguments -join " "))
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = if ($LASTEXITCODE -eq $null) { 0 } else { $LASTEXITCODE }
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    throw "$FilePath exited with code $exitCode"
  }
}

function Assert-PagesRepo {
  param([string]$Path)

  $resolved = Resolve-Path -LiteralPath $Path
  $gitDir = Join-Path $resolved ".git"
  if (-not (Test-Path -LiteralPath $gitDir)) {
    throw "Pages repository is not a git checkout: $resolved"
  }

  $remote = (& git -C $resolved remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not ($remote -match "loxtyrrell03\.github\.io")) {
    throw "Refusing to deploy to unexpected git remote: $remote"
  }

  return $resolved.Path
}

if (-not $SourceDir) {
  $SourceDir = if ($env:EN_CROISSANT_WEB_FILES_DIR) {
    $env:EN_CROISSANT_WEB_FILES_DIR
  } else {
    Join-Path $env:USERPROFILE "Documents\EnCroissant"
  }
}

if (-not $PagesRepo) {
  $PagesRepo = if ($env:EN_CROISSANT_PAGES_REPO) {
    $env:EN_CROISSANT_PAGES_REPO
  } else {
    Join-Path $logRoot "loxtyrrell03.github.io"
  }
}

if (-not $CommitMessage) {
  $CommitMessage = "Auto-sync En Croissant phone site {0}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm")
}

$resolvedSource = Resolve-Path -LiteralPath $SourceDir
Write-Log "source: $resolvedSource"
Write-Log "pages repo: $PagesRepo"

if (-not $SkipBuild) {
  $env:EN_CROISSANT_WEB_FILES_DIR = $resolvedSource.Path
  if ($SkipDatabaseExports) {
    $env:EN_CROISSANT_WEB_EXPORT_DATABASES = "0"
  } elseif ($MaxDatabaseMB -gt 0) {
    $env:EN_CROISSANT_WEB_DB_MAX_MB = "$MaxDatabaseMB"
  }
  Invoke-Logged "npm.cmd" @("run", "web:library") $repoRoot.Path
  Invoke-Logged "npm.cmd" @("run", "build-vite") $repoRoot.Path
}

if (-not (Test-Path -LiteralPath $PagesRepo)) {
  New-Item -Path (Split-Path -Parent $PagesRepo) -ItemType Directory -Force | Out-Null
  Invoke-Logged "git" @("clone", $PagesRemote, $PagesRepo) $repoRoot.Path
}

$resolvedPages = Assert-PagesRepo $PagesRepo
Invoke-Logged "git" @("-C", $resolvedPages, "pull", "--ff-only", "origin", "main") $repoRoot.Path

$dist = Resolve-Path -LiteralPath (Join-Path $repoRoot "dist")
Write-Log "mirroring $dist -> $resolvedPages"

Get-ChildItem -LiteralPath $resolvedPages -Force |
  Where-Object { $_.Name -ne ".git" } |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }

$null = & robocopy $dist $resolvedPages /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP
$copyExitCode = $LASTEXITCODE
if ($copyExitCode -ge 8) {
  throw "robocopy failed with code $copyExitCode"
}
New-Item -Path (Join-Path $resolvedPages ".nojekyll") -ItemType File -Force | Out-Null

$status = & git -C $resolvedPages status --porcelain
if (-not $status) {
  Write-Log "no site changes to publish"
  exit 0
}

Invoke-Logged "git" @("-C", $resolvedPages, "add", "-A") $repoRoot.Path
& git -C $resolvedPages diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Log "no staged site changes to publish"
  exit 0
}
if ($LASTEXITCODE -ne 1) {
  throw "git diff --cached failed with code $LASTEXITCODE"
}

Invoke-Logged "git" @("-C", $resolvedPages, "commit", "-m", $CommitMessage) $repoRoot.Path

if ($NoPush) {
  Write-Log "committed without push because -NoPush was set"
  exit 0
}

Invoke-Logged "git" @("-C", $resolvedPages, "push", "origin", "main") $repoRoot.Path
Write-Log "published phone site"
