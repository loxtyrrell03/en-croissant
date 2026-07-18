param(
  [int]$Port = 8787,
  [int]$MaxDatabaseMB = 4096,
  [switch]$SkipInitialLibrary
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$siteRoot = Join-Path $serverRoot 'site'
$stagingRoot = Join-Path $serverRoot 'site-staging'
$previousRoot = Join-Path $serverRoot 'site-previous'
$documentsRoot = Join-Path $env:USERPROFILE 'Documents\EnCroissant'
$databaseRoots = @(
  (Join-Path $env:APPDATA 'org.encroissant.app\db'),
  (Join-Path $env:APPDATA 'org.encroissant.fork\db')
) | Where-Object { Test-Path -LiteralPath $_ }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
$startScript = Join-Path $PSScriptRoot 'start-home-server.ps1'
$taskName = 'EnCroissantHomeServer'

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null

Push-Location $repoRoot
try {
  & $npm run build-vite
  if ($LASTEXITCODE -ne 0) {
    throw "Phone app build failed with exit code $LASTEXITCODE."
  }

  Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $repoRoot 'dist\*') -Destination $stagingRoot -Recurse -Force

  if (-not $SkipInitialLibrary) {
    $env:EN_CROISSANT_WEB_FILES_DIR = $documentsRoot
    $env:EN_CROISSANT_WEB_DATABASE_DIRS = $databaseRoots -join [IO.Path]::PathSeparator
    $env:EN_CROISSANT_WEB_DB_MAX_MB = [string]$MaxDatabaseMB
    & (Get-Command node.exe -ErrorAction Stop).Source `
      (Join-Path $PSScriptRoot 'build-web-library.mjs') `
      --output (Join-Path $stagingRoot 'web-library')
    if ($LASTEXITCODE -ne 0) {
      throw "Initial live-library build failed with exit code $LASTEXITCODE."
    }
  } elseif (Test-Path -LiteralPath (Join-Path $siteRoot 'web-library')) {
    Copy-Item -LiteralPath (Join-Path $siteRoot 'web-library') `
      -Destination (Join-Path $stagingRoot 'web-library') -Recurse -Force
  }

  Remove-Item -LiteralPath $previousRoot -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $siteRoot) {
    Move-Item -LiteralPath $siteRoot -Destination $previousRoot
  }
  Move-Item -LiteralPath $stagingRoot -Destination $siteRoot
  Remove-Item -LiteralPath $previousRoot -Recurse -Force -ErrorAction SilentlyContinue
} finally {
  Pop-Location
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port $Port"
& schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskCommand /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not register the per-user home-server startup task."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript -Port $Port
if ($LASTEXITCODE -ne 0) {
  throw "The home server did not start."
}

& $tailscale serve --bg --yes $Port
if ($LASTEXITCODE -ne 0) {
  throw "Tailscale Serve could not expose the home server."
}

# Keep the server available while the PC is plugged in. Turning the display
# off is still allowed; only automatic sleep/hibernate timers are disabled.
& powercfg.exe /change standby-timeout-ac 0 | Out-Null
& powercfg.exe /change hibernate-timeout-ac 0 | Out-Null

$status = & $tailscale serve status --json | ConvertFrom-Json
$dnsName = (& $tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
[pscustomobject]@{
  Installed = $true
  Url = "https://$dnsName/"
  LocalHealth = "http://127.0.0.1:$Port/api/health"
  SiteRoot = $siteRoot
  StartupTask = $taskName
  TailscaleServe = $status
} | ConvertTo-Json -Depth 8
