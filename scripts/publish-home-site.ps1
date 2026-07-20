param(
  [string]$SiteUrl = "https://gaming-pc.tail89d19b.ts.net",
  [string]$SiteRoot = "",
  [int]$Port = 8787,
  [switch]$SkipBuild,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $env:LOCALAPPDATA "EnCroissantHomeServer"
if (-not $SiteRoot) {
  $SiteRoot = Join-Path $serverRoot "site"
}

if (-not (Test-Path -LiteralPath $SiteRoot)) {
  throw "The PC phone site is not installed at $SiteRoot. Run web:install-home-server once."
}

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
  }

  $distRoot = Resolve-Path -LiteralPath (Join-Path $repoRoot "dist")
  & robocopy.exe $distRoot $SiteRoot /E /R:2 /W:1 /XD (Join-Path $distRoot "web-library") | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Could not update the PC phone site (robocopy exit code $LASTEXITCODE)."
  }
} finally {
  Pop-Location
}

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

[pscustomobject]@{
  Published = $true
  Url = "$($SiteUrl.TrimEnd('/'))/"
  SiteRoot = (Resolve-Path -LiteralPath $SiteRoot).Path
  PrivateTailscale = $true
  Stockfish = "$($SiteUrl.TrimEnd('/'))/v1/analyze"
  StockfishThreads = $stockfish.threads
  StockfishHashMb = $stockfish.hashMb
} | ConvertTo-Json -Depth 4
