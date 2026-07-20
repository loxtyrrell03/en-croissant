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
. (Join-Path $scriptRoot "phone-publish-guard.ps1")
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

function Install-PagesPublishGuard {
  param(
    [Parameter(Mandatory = $true)][string]$PagesPath,
    [Parameter(Mandatory = $true)][string]$CanonicalSourceRepo
  )

  $hooksRoot = Join-Path $logRoot "hooks"
  New-Item -Path $hooksRoot -ItemType Directory -Force | Out-Null
  $hookPath = Join-Path $hooksRoot "pre-commit"
  $validatorPath = (Join-Path $CanonicalSourceRepo "scripts\validate-pages-publish.ps1").Replace("\", "/")
  $sourcePath = $CanonicalSourceRepo.Replace("\", "/")
  $hook = @"
#!/bin/sh
exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$validatorPath' -SourceRepo '$sourcePath'
"@
  [System.IO.File]::WriteAllText(
    $hookPath,
    $hook.Replace("`r`n", "`n") + "`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Invoke-Logged "git" @("-C", $PagesPath, "config", "core.hooksPath", $hooksRoot) $repoRoot.Path
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

$publishContext = Enter-EnCroissantPhonePublish -RepoRoot $repoRoot.Path -TargetName "GitHub Pages phone site"
try {
  $resolvedSource = Resolve-Path -LiteralPath $SourceDir
  Write-Log "source: $resolvedSource"
  Write-Log "pages repo: $PagesRepo"

  if (-not (Test-Path -LiteralPath $PagesRepo)) {
    New-Item -Path (Split-Path -Parent $PagesRepo) -ItemType Directory -Force | Out-Null
    Invoke-Logged "git" @("clone", $PagesRemote, $PagesRepo) $repoRoot.Path
  }

  $resolvedPages = Assert-PagesRepo $PagesRepo
  Invoke-Logged "git" @("-C", $resolvedPages, "pull", "--ff-only", "origin", "main") $repoRoot.Path
  Install-PagesPublishGuard `
    -PagesPath $resolvedPages `
    -CanonicalSourceRepo $publishContext.CanonicalRepoRoot
  Assert-EnCroissantPublishDescendsFrom `
    -RepoRoot $repoRoot.Path `
    -SourceCommit $publishContext.SourceCommit `
    -DeploymentMetadataPath (Join-Path $resolvedPages "app-version.json") `
    -TargetName "GitHub Pages phone site"

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

  $dist = (Resolve-Path -LiteralPath (Join-Path $repoRoot "dist")).Path
  if ($SkipBuild) {
    Assert-EnCroissantPhoneBuildMetadata `
      -Root $dist `
      -ExpectedSourceCommit $publishContext.SourceCommit | Out-Null
  } else {
    Set-EnCroissantPhoneBuildMetadata `
      -DistRoot $dist `
      -PublishContext $publishContext | Out-Null
  }
  Assert-EnCroissantPhoneBuildMetadata `
    -Root $dist `
    -ExpectedSourceCommit $publishContext.SourceCommit | Out-Null

  Write-Log "mirroring $dist -> $resolvedPages"
  $gitDirectory = Join-Path $resolvedPages ".git"
  & robocopy.exe $dist $resolvedPages /MIR /R:2 /W:1 /XD $gitDirectory | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Could not mirror the phone site (robocopy exit code $LASTEXITCODE)."
  }
  New-Item -Path (Join-Path $resolvedPages ".nojekyll") -ItemType File -Force | Out-Null

  $status = & git -C $resolvedPages status --porcelain
  if (-not $status) {
    Write-Log "no site changes to publish"
    return
  }

  Invoke-Logged "git" @("-C", $resolvedPages, "add", "-A") $repoRoot.Path
  & git -C $resolvedPages diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Log "no staged site changes to publish"
    return
  }
  if ($LASTEXITCODE -ne 1) {
    throw "git diff --cached failed with code $LASTEXITCODE"
  }

  Invoke-Logged "git" @("-C", $resolvedPages, "commit", "-m", $CommitMessage) $repoRoot.Path

  if ($NoPush) {
    Write-Log "committed without push because -NoPush was set"
    return
  }

  Invoke-Logged "git" @("-C", $resolvedPages, "push", "origin", "main") $repoRoot.Path
  Write-Log "published phone site"
} finally {
  Exit-EnCroissantPhonePublish -Context $publishContext
}
