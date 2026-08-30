$ErrorActionPreference = 'Stop'
$scriptsRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $scriptsRoot 'run-installed-home-server.ps1'
$stagerPath = Join-Path $scriptsRoot 'start-home-server.ps1'
$installerPath = Join-Path $scriptsRoot 'install-home-server-launcher.ps1'
$publisherPath = Join-Path $scriptsRoot 'publish-home-site.ps1'
$collectorTerminatorPath = Join-Path $scriptsRoot 'terminate-collector-process-tree.ps1'

foreach ($path in @(
  $launcherPath,
  $stagerPath,
  $installerPath,
  $publisherPath,
  $collectorTerminatorPath
)) {
  $tokens = $null
  $parseErrors = $null
  [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "$path has PowerShell parse errors: $($parseErrors -join '; ')"
  }
}

$launcher = Get-Content -Raw -LiteralPath $launcherPath
if ($launcher -notmatch "runtime-deployment\.json") {
  throw 'The installed launcher does not require deployed runtime identity.'
}
if ($launcher -match 'Join-Path\s+\$PSScriptRoot\s+''home-server\.mjs''') {
  throw 'The installed launcher can still copy or execute a checkout-local home server.'
}
if ($launcher -notmatch 'taskkill\.exe\s+/PID.*?/T\s+/F') {
  throw 'The installed launcher does not stop the owned home-server process tree.'
}

$installer = Get-Content -Raw -LiteralPath $installerPath
if ($installer -notmatch "launcher.*run-installed-home-server\.ps1") {
  throw 'The task installer does not target the installed launcher directory.'
}
if ($installer -match "-File\s+.*start-home-server\.ps1") {
  throw 'The task installer still points the scheduled action at a source checkout.'
}

$publisher = Get-Content -Raw -LiteralPath $publisherPath
$migrationIndex = $publisher.IndexOf('install-home-server-launcher.ps1')
$runtimeMutationIndex = $publisher.IndexOf('$collectorDestination')
if ($migrationIndex -lt 0 -or $runtimeMutationIndex -lt 0 -or $migrationIndex -gt $runtimeMutationIndex) {
  throw 'Publishing does not migrate the scheduled launcher before mutating the runtime.'
}

$stager = Get-Content -Raw -LiteralPath $stagerPath
foreach ($required in @(
  'run-installed-home-server.ps1',
  'runtime-deployment.json',
  'terminate-collector-process-tree.ps1'
)) {
  if ($stager -notmatch [Regex]::Escape($required)) {
    throw "The runtime stager is missing $required."
  }
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  $collectorTerminatorPath `
  -TargetProcessId ([int]::MaxValue) `
  -ExpectedExecutable 'C:\missing\collect_otb_games.exe' `
  -ExpectedJobId 'otb-no-such-process'
if ($LASTEXITCODE -ne 0) {
  throw 'A collector PID that no longer exists should be treated as already stopped.'
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  $collectorTerminatorPath `
  -TargetProcessId $PID `
  -ExpectedExecutable 'C:\missing\collect_otb_games.exe' `
  -ExpectedJobId 'otb-wrong-process' 2>$null
$mismatchedPidExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($mismatchedPidExitCode -eq 0) {
  throw 'Collector cleanup did not refuse a PID owned by a different executable.'
}

Write-Output 'Home-server launcher safeguards passed.'
