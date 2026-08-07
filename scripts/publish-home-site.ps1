param(
  [string]$SiteUrl = "https://lox.tail89d19b.ts.net",
  [string]$SiteRoot = "",
  [int]$Port = 8787,
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "phone-publish-guard.ps1")

$serverRoot = Join-Path $env:LOCALAPPDATA "EnCroissantHomeServer"
$appReleasesRoot = Join-Path $serverRoot "app-releases"
$activeAppPath = Join-Path $serverRoot "active-app.json"
if (-not $SiteRoot) {
  $SiteRoot = Join-Path $serverRoot "site"
}

if (-not (Test-Path -LiteralPath $SiteRoot)) {
  throw "The PC phone site is not installed at $SiteRoot. Run web:install-home-server once."
}

$publishContext = Enter-EnCroissantPhonePublish -RepoRoot $repoRoot -TargetName "PC phone site"
try {
  Assert-EnCroissantPublishDescendsFrom `
    -RepoRoot $repoRoot `
    -SourceCommit $publishContext.SourceCommit `
    -DeploymentMetadataPath $activeAppPath `
    -TargetName "PC phone site"

  Push-Location $repoRoot
  try {
    if (-not $SkipBuild) {
      $env:VITE_EN_CROISSANT_HOME_BUILD = "1"
      $env:VITE_EN_CROISSANT_SERVER_URL = $SiteUrl.TrimEnd("/")
      $env:VITE_EN_CROISSANT_STOCKFISH_URL = $SiteUrl.TrimEnd("/")
      & (Get-Command npm.cmd -ErrorAction Stop).Source run build-vite
      if ($LASTEXITCODE -ne 0) {
        throw "Phone app build failed with exit code $LASTEXITCODE."
      }
      Copy-EnCroissantPhonePublicShell `
        -PublicRoot (Join-Path $repoRoot "public") `
        -DistRoot (Join-Path $repoRoot "dist")
    }
  } finally {
    Pop-Location
  }

  Assert-EnCroissantPublishSourceUnchanged `
    -RepoRoot $repoRoot `
    -PublishContext $publishContext

  $distRoot = (Resolve-Path -LiteralPath (Join-Path $repoRoot "dist")).Path
  if ($SkipBuild) {
    $buildMetadata = Assert-EnCroissantPhoneBuildMetadata `
      -Root $distRoot `
      -ExpectedSourceCommit $publishContext.SourceCommit
  } else {
    $buildMetadata = Set-EnCroissantPhoneBuildMetadata `
      -DistRoot $distRoot `
      -PublishContext $publishContext
  }
  Assert-EnCroissantPhoneBuildMetadata `
    -Root $distRoot `
    -ExpectedSourceCommit $publishContext.SourceCommit | Out-Null

  New-Item -ItemType Directory -Path $appReleasesRoot -Force | Out-Null
  $releaseId = "{0}-{1}" -f `
    $publishContext.SourceCommit.Substring(0, 12), `
    ([string]$buildMetadata.appShellSha256).Substring(0, 12)
  $releaseRoot = Join-Path $appReleasesRoot $releaseId

  if (-not (Test-Path -LiteralPath $releaseRoot)) {
    $stagingRoot = Join-Path $appReleasesRoot (".staging-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    try {
      & robocopy.exe $distRoot $stagingRoot /E /R:2 /W:1 /XD (Join-Path $distRoot "web-library") | Out-Null
      if ($LASTEXITCODE -ge 8) {
        throw "Could not stage the PC phone app (robocopy exit code $LASTEXITCODE)."
      }
      Assert-EnCroissantPhoneBuildMetadata `
        -Root $stagingRoot `
        -ExpectedSourceCommit $publishContext.SourceCommit | Out-Null
      [System.IO.Directory]::Move($stagingRoot, $releaseRoot)
    } finally {
      if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
      }
    }
  } else {
    $existingRelease = Assert-EnCroissantPhoneBuildMetadata `
      -Root $releaseRoot `
      -ExpectedSourceCommit $publishContext.SourceCommit
    if ($existingRelease.appShellSha256 -ne $buildMetadata.appShellSha256) {
      throw "The immutable phone release $releaseId does not match this build."
    }
  }

  $activeApp = [ordered]@{
    schemaVersion = 1
    releaseId = $releaseId
    sourceCommit = $publishContext.SourceCommit
    sourceBranch = $publishContext.SourceBranch
    builtAt = $buildMetadata.builtAt
    appShellSha256 = $buildMetadata.appShellSha256
  }
  Assert-EnCroissantPublishSourceUnchanged `
    -RepoRoot $repoRoot `
    -PublishContext $publishContext
  Write-EnCroissantJsonAtomically -Path $activeAppPath -Value $activeApp

  if (-not $SkipRestart) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
      (Join-Path $PSScriptRoot "start-home-server.ps1") -Port $Port -ForceRestart
    if ($LASTEXITCODE -ne 0) {
      throw "The PC phone server did not restart."
    }

    & (Get-Command tailscale.exe -ErrorAction Stop).Source serve --bg --yes $Port
    if ($LASTEXITCODE -ne 0) {
      throw "Tailscale Serve could not expose the PC phone site privately."
    }
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $stockfish = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/health" -TimeoutSec 5
  if (-not $health.ok -or -not $stockfish.ok) {
    throw "The PC phone site or Stockfish proxy failed its health check."
  }
  if ([string]$health.deployment.sourceCommit -ne $publishContext.SourceCommit) {
    throw "The PC phone server is not serving the release that was just published."
  }

  [pscustomobject]@{
    Published = $true
    Url = "$($SiteUrl.TrimEnd('/'))/"
    SiteRoot = (Resolve-Path -LiteralPath $SiteRoot).Path
    ActiveAppRoot = $health.activeAppRoot
    SourceCommit = $health.deployment.sourceCommit
    PrivateTailscale = $true
    Stockfish = "$($SiteUrl.TrimEnd('/'))/v1/analyze"
    StockfishThreads = $stockfish.threads
    StockfishHashMb = $stockfish.hashMb
  } | ConvertTo-Json -Depth 4
} finally {
  Exit-EnCroissantPhonePublish -Context $publishContext
}
