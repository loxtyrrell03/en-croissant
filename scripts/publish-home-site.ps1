param(
  [string]$SiteUrl = "https://lox-pc.tail89d19b.ts.net",
  [string]$SiteRoot = "",
  [int]$Port = 8787,
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
$tailStatus = & (Get-Command tailscale.exe -ErrorAction Stop).Source status --json | ConvertFrom-Json
$serveBefore = & (Get-Command tailscale.exe -ErrorAction Stop).Source serve status --json | ConvertFrom-Json
if ($SiteUrl.TrimEnd('/') -ne 'https://lox-pc.tail89d19b.ts.net' -or
    $tailStatus.Self.DNSName.TrimEnd('.') -ne 'lox-pc.tail89d19b.ts.net' -or
    $serveBefore.Web.'lox-pc.tail89d19b.ts.net:443'.Handlers.'/'.Proxy -ne 'http://127.0.0.1:8786' -or $Port -ne 8787) {
  throw 'The existing lox-pc phone identity/controller route does not match the owner contract. Diagnose it before publishing; do not replace Serve routes.'
}
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

  # Ordinary publication preserves the installed supervisor, tasks and routes.
  if (-not (Test-Path -LiteralPath (Join-Path $serverRoot 'launcher\controller-config.json'))) {
    throw 'The installed phone controller is missing. Restore that service before publishing.'
  }
  $phoneState = Get-Content -Raw -LiteralPath (Join-Path $serverRoot 'phone-services.json') | ConvertFrom-Json
  if (-not $phoneState.enabled -and -not $SkipRestart) { throw 'PC services are explicitly off. Publication will not turn them on.' }

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
        & $bundledNode (Join-Path $repoRoot 'node_modules\vite\bin\vite.js') build --config (Join-Path $repoRoot 'vite.review-worker.config.ts')
        if ($LASTEXITCODE -ne 0) { throw "Shared review service build failed." }
        & $bundledNode (Join-Path $repoRoot 'node_modules\@typescript\native-preview\bin\tsgo.js') --noEmit -p tsconfig.review-worker.json
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
      & $cargoCommand.Source build --release --locked `
        --manifest-path (Join-Path $repoRoot 'src-tauri\tournament-core\Cargo.toml') `
        --target-dir (Join-Path $repoRoot 'src-tauri\target')
      if ($LASTEXITCODE -ne 0) { throw 'Phone tournament helper build failed.' }
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

  # Recheck owner intent and active work immediately before runtime publication.
  $phoneState = Get-Content -Raw -LiteralPath (Join-Path $serverRoot 'phone-services.json') | ConvertFrom-Json
  if (-not $phoneState.enabled -and -not $SkipRestart) { throw 'PC services were turned off during the build.' }
  $healthBefore = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $reviewBefore = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/mistake-review" -TimeoutSec 5
  if ($reviewBefore.running) { throw 'Background review is active. Publication must wait for it to finish.' }
  if ($healthBefore.libraryRefreshRunning -or $healthBefore.lichessExplorerRequests -gt 0 -or $healthBefore.otbActiveImports -gt 0 -or $healthBefore.tournamentRequests -gt 0) { throw 'The phone server has active work. Publish again after it finishes.' }
  $activeCollectors = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $healthBefore.pid -and $_.Name -match 'collect_otb_games|codex' })
  if ($activeCollectors.Count) { throw 'An import or assistant operation is active; publication must wait.' }
  $collectorName = if ($env:OS -eq "Windows_NT") { "collect_otb_games.exe" } else { "collect_otb_games" }
  $collectorSource = Join-Path $repoRoot "src-tauri\target\release\$collectorName"
  if (-not (Test-Path -LiteralPath $collectorSource)) {
    throw "The matching phone OTB collector is missing at $collectorSource."
  }
  $tournamentSource = Join-Path $repoRoot 'src-tauri\target\release\encroissant-tournament-core.exe'
  $tournamentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tournamentSource).Hash
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $collectorDestination = Join-Path $runtimeRoot $collectorName
  $temporaryCollector = "$collectorDestination.next-$PID"
  Copy-Item -LiteralPath $collectorSource -Destination $temporaryCollector -Force
  Move-Item -LiteralPath $temporaryCollector -Destination $collectorDestination -Force
  $collectorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $collectorDestination).Hash

  $tournamentName = 'encroissant-tournament-core-' + $publishContext.SourceCommit.Substring(0, 12) + '.exe'
  $tournamentDestination = Join-Path $runtimeRoot $tournamentName
  $tournamentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tournamentSource).Hash
  if (Test-Path -LiteralPath $tournamentDestination) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $tournamentDestination).Hash -ne $tournamentHash) { throw 'The immutable tournament helper differs from this release.' }
  } else { Copy-Item -LiteralPath $tournamentSource -Destination $tournamentDestination }

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

  $serveAfter = & (Get-Command tailscale.exe -ErrorAction Stop).Source serve status --json | ConvertFrom-Json
  if (($serveAfter | ConvertTo-Json -Depth 30 -Compress) -ne ($serveBefore | ConvertTo-Json -Depth 30 -Compress)) { throw 'The shared Serve configuration changed during publication.' }

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
    TournamentHelperSha256 = $tournamentHash
    PrivateTailscale = $true
    Stockfish = "$($SiteUrl.TrimEnd('/'))/v1/analyze"
    StockfishThreads = $stockfish.threads
    StockfishHashMb = $stockfish.hashMb
  } | ConvertTo-Json -Depth 4
} finally {
  Exit-EnCroissantPhonePublish -Context $publishContext
}
