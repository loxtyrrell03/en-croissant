param(
  [int]$Port = 8787,
  [int]$MaxDatabaseMB = 1024,
  [switch]$SkipInitialLibrary,
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$siteRoot = Join-Path $serverRoot 'site'
$stagingRoot = Join-Path $serverRoot 'site-staging'
$previousRoot = Join-Path $serverRoot 'site-previous'
$documentsRoot = Join-Path $env:USERPROFILE 'Documents\EnCroissant'
$databaseRoots = @(
  (Join-Path $env:APPDATA 'org.encroissant.app\db')
) | Where-Object { Test-Path -LiteralPath $_ }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
$startScript = Join-Path $PSScriptRoot 'start-home-server.ps1'
$taskName = 'EnCroissantHomeServer'
$dnsName = (& $tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
if (-not $dnsName) {
  throw 'This machine does not have an active Tailscale DNS name.'
}
$privateOrigin = "https://$dnsName"
$configuredPrivateOrigins = @(
  ([Environment]::GetEnvironmentVariable('EN_CROISSANT_PRIVATE_ORIGINS', 'User') -split '[,;\r\n]') |
    ForEach-Object { $_.Trim().TrimEnd('/') } |
    Where-Object { $_ }
  $privateOrigin
) | Select-Object -Unique
$privateOriginsValue = $configuredPrivateOrigins -join ','
[Environment]::SetEnvironmentVariable(
  'EN_CROISSANT_PRIVATE_ORIGINS',
  $privateOriginsValue,
  'User'
)
$env:EN_CROISSANT_PRIVATE_ORIGINS = $privateOriginsValue

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null

# Installation owns the export cache while it builds the staged library. Stop
# only this server's existing Node process so its file watcher cannot start a
# duplicate export against the same cache.
$pidPath = Join-Path $serverRoot 'home-server.pid'
if (Test-Path -LiteralPath $pidPath) {
  $serverPid = [int](Get-Content -Raw -LiteralPath $pidPath)
  $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid" -ErrorAction SilentlyContinue
  if ($serverProcess -and [string]$serverProcess.CommandLine -like '*scripts\home-server.mjs*') {
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $serverPid -Timeout 10 -ErrorAction SilentlyContinue
  }
}

Push-Location $repoRoot
try {
  $queryHelperSource = Join-Path $repoRoot 'src-tauri\src\bin\query_db_position.rs'
  $queryHelper = Join-Path $repoRoot 'src-tauri\target\debug\query_db_position.exe'
  if (
    -not (Test-Path -LiteralPath $queryHelper) -or
    (Get-Item -LiteralPath $queryHelperSource).LastWriteTimeUtc -gt
      (Get-Item -LiteralPath $queryHelper).LastWriteTimeUtc
  ) {
    & (Get-Command cargo.exe -ErrorAction Stop).Source build `
      --manifest-path (Join-Path $repoRoot 'src-tauri\Cargo.toml') `
      --bin query_db_position
    if ($LASTEXITCODE -ne 0) {
      throw "Database query helper build failed with exit code $LASTEXITCODE."
    }
  }

  if (-not $SkipFrontendBuild) {
    & $npm run build-vite
    if ($LASTEXITCODE -ne 0) {
      throw "Phone app build failed with exit code $LASTEXITCODE."
    }
  }

  Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  $distRoot = Join-Path $repoRoot 'dist'
  & robocopy.exe $distRoot $stagingRoot /E /R:2 /W:1 /XD (Join-Path $distRoot 'web-library') | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Could not stage the phone app build (robocopy exit code $LASTEXITCODE)."
  }

  if (-not $SkipInitialLibrary) {
    $env:EN_CROISSANT_WEB_FILES_DIR = $documentsRoot
    $env:EN_CROISSANT_WEB_DATABASE_DIRS = $databaseRoots -join [IO.Path]::PathSeparator
    $env:EN_CROISSANT_WEB_DB_MAX_MB = [string]$MaxDatabaseMB
    $env:EN_CROISSANT_WEB_DB_EXPORT_CACHE = Join-Path $serverRoot 'db-exports'
    & (Get-Command node.exe -ErrorAction Stop).Source `
      (Join-Path $PSScriptRoot 'build-web-library.mjs') `
      --output (Join-Path $stagingRoot 'web-library')
    if ($LASTEXITCODE -ne 0) {
      throw "Initial live-library build failed with exit code $LASTEXITCODE."
    }
  } elseif (Test-Path -LiteralPath (Join-Path $siteRoot 'web-library')) {
    $existingLibrary = Join-Path $siteRoot 'web-library'
    $stagedLibrary = Join-Path $stagingRoot 'web-library'
    & robocopy.exe $existingLibrary $stagedLibrary /E /R:2 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) {
      throw "Could not reuse the current phone library (robocopy exit code $LASTEXITCODE)."
    }
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

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -Port $Port"
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId $taskUser `
  -LogonType Interactive `
  -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$taskSettings.Priority = 4
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Principal $taskPrincipal `
  -Settings $taskSettings `
  -Force | Out-Null

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
[pscustomobject]@{
  Installed = $true
  Url = "https://$dnsName/"
  LocalHealth = "http://127.0.0.1:$Port/api/health"
  SiteRoot = $siteRoot
  StartupTask = $taskName
  TailscaleServe = $status
} | ConvertTo-Json -Depth 8
