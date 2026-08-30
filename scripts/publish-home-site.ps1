param(
  [string]$SiteUrl = "https://lox-pc.tail89d19b.ts.net",
  [string]$SiteRoot = "",
  [int]$Port = 8787,
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "phone-publish-guard.ps1")

$serverRoot = Join-Path $env:LOCALAPPDATA "EnCroissantHomeServer"
$runtimeRoot = Join-Path $serverRoot "runtime"
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

  # Migrate the scheduled task before touching the deployed runtime. Its
  # installed launcher never copies files from a checkout, so an older checkout
  # cannot overwrite this release at the next logon.
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
    (Join-Path $PSScriptRoot "install-home-server-launcher.ps1") `
    -Port $Port `
    -ServerRoot $serverRoot | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The source-independent home-server launcher could not be installed."
  }

  Push-Location $repoRoot
  try {
    if (-not $SkipBuild) {
      $env:VITE_EN_CROISSANT_HOME_BUILD = "1"
      $env:VITE_EN_CROISSANT_SERVER_URL = $SiteUrl.TrimEnd("/")
      $env:VITE_EN_CROISSANT_STOCKFISH_URL = $SiteUrl.TrimEnd("/")
      $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
      if ($npmCommand) {
        & $npmCommand.Source run build-vite
        if ($LASTEXITCODE -ne 0) {
          throw "Phone app build failed with exit code $LASTEXITCODE."
        }
      } else {
        $bundledNode = 'C:\Users\Lox\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (-not (Test-Path -LiteralPath $bundledNode)) {
          throw "Phone app build needs Node.js, but neither npm.cmd nor the bundled Codex runtime is available."
        }
        & $bundledNode (Join-Path $repoRoot 'node_modules\vite\bin\vite.js') `
          build --config (Join-Path $repoRoot 'vite.otb-prep.config.ts')
        if ($LASTEXITCODE -ne 0) {
          throw "Phone OTB prep build failed with exit code $LASTEXITCODE."
        }
        & $bundledNode (Join-Path $repoRoot 'node_modules\@typescript\native-preview\bin\tsgo.js') --noEmit
        if ($LASTEXITCODE -ne 0) {
          throw "Phone app typecheck failed with exit code $LASTEXITCODE."
        }
        & $bundledNode (Join-Path $repoRoot 'node_modules\vite\bin\vite.js') build
        if ($LASTEXITCODE -ne 0) {
          throw "Phone app build failed with exit code $LASTEXITCODE."
        }
      }
      Copy-EnCroissantPhonePublicShell `
        -PublicRoot (Join-Path $repoRoot "public") `
        -DistRoot (Join-Path $repoRoot "dist")

      $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
      if (-not $cargoCommand) {
        throw "The phone OTB collector build needs cargo.exe."
      }
      & $cargoCommand.Source build --release `
        --manifest-path (Join-Path $repoRoot "src-tauri\Cargo.toml") `
        --bin collect_otb_games `
        --features headless-otb
      if ($LASTEXITCODE -ne 0) {
        throw "Phone OTB collector build failed with exit code $LASTEXITCODE."
      }
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

  $collectorName = if ($env:OS -eq "Windows_NT") { "collect_otb_games.exe" } else { "collect_otb_games" }
  $collectorSource = Join-Path $repoRoot "src-tauri\target\release\$collectorName"
  if (-not (Test-Path -LiteralPath $collectorSource)) {
    throw "The matching phone OTB collector is missing at $collectorSource."
  }
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $collectorDestination = Join-Path $runtimeRoot $collectorName
  $temporaryCollector = "$collectorDestination.next-$PID"
  Copy-Item -LiteralPath $collectorSource -Destination $temporaryCollector -Force
  Move-Item -LiteralPath $temporaryCollector -Destination $collectorDestination -Force
  $collectorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $collectorDestination).Hash

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

  $startArguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    (Join-Path $PSScriptRoot "start-home-server.ps1"),
    '-Port',
    [string]$Port
  )
  if ($SkipRestart) {
    $startArguments += '-StageOnly'
  } else {
    $startArguments += '-ForceRestart'
  }
  & powershell.exe @startArguments
  if ($LASTEXITCODE -ne 0) {
    throw "The PC phone server runtime could not be staged or restarted."
  }

  if (-not $SkipRestart) {
    & (Get-Command tailscale.exe -ErrorAction Stop).Source serve --bg --yes $Port
    if ($LASTEXITCODE -ne 0) {
      throw "Tailscale Serve could not expose the PC phone site privately."
    }
  }

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $stockfishStart = Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$Port/api/engine/start" `
    -ContentType "application/json" `
    -Body "{}" `
    -TimeoutSec 25
  $stockfish = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/health" -TimeoutSec 5
  if (-not $health.ok -or -not $stockfishStart.ok -or -not $stockfish.ok) {
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
    OtbImporterSha256 = $collectorHash
    PrivateTailscale = $true
    Stockfish = "$($SiteUrl.TrimEnd('/'))/v1/analyze"
    StockfishThreads = $stockfish.threads
    StockfishHashMb = $stockfish.hashMb
  } | ConvertTo-Json -Depth 4
} finally {
  Exit-EnCroissantPhonePublish -Context $publishContext
}
