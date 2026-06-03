param(
  [string]$SourceDir = "",
  [string]$PagesRepo = "",
  [int]$DebounceSeconds = 90,
  [int]$PeriodicMinutes = 30,
  [switch]$NoInitialRun
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot "..")
$watchScript = Join-Path $scriptRoot "watch-web-sync.ps1"
$taskName = "EnCroissantWebAutoSync"
$taskPath = "\EnCroissant\"
$logRoot = Join-Path $env:LOCALAPPDATA "EnCroissantWebSync"

New-Item -Path $logRoot -ItemType Directory -Force | Out-Null

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

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", "`"$watchScript`"",
  "-SourceDir", "`"$SourceDir`"",
  "-PagesRepo", "`"$PagesRepo`"",
  "-DebounceSeconds", $DebounceSeconds,
  "-PeriodicMinutes", $PeriodicMinutes
)

if (-not $NoInitialRun) {
  $arguments += "-RunInitial"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ($arguments -join " ") `
  -WorkingDirectory $repoRoot.Path

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -TaskPath $taskPath `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Keeps the En Croissant phone site synced with published PGN/PDF files." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath

Write-Host "Installed and started $taskPath$taskName"
Write-Host "Watching: $SourceDir"
Write-Host "Pages checkout: $PagesRepo"
Write-Host "Logs: $logRoot"
