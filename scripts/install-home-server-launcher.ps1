param(
  [int]$Port = 8787,
  [string]$TaskName = 'EnCroissantHomeServer',
  [string]$ServerRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $ServerRoot) {
  $ServerRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
}
$ServerRoot = [IO.Path]::GetFullPath($ServerRoot)
$launcherRoot = Join-Path $ServerRoot 'launcher'
$sourceLauncher = Join-Path $PSScriptRoot 'run-installed-home-server.ps1'
$installedLauncher = Join-Path $launcherRoot 'run-installed-home-server.ps1'

New-Item -ItemType Directory -Path $launcherRoot -Force | Out-Null
$temporaryLauncher = "$installedLauncher.next-$PID"
Copy-Item -LiteralPath $sourceLauncher -Destination $temporaryLauncher -Force
Move-Item -LiteralPath $temporaryLauncher -Destination $installedLauncher -Force

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedLauncher`" -Port $Port -ServerRoot `"$ServerRoot`""
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId $taskUser `
  -LogonType Interactive `
  -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$taskSettings.Priority = 4

Stop-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $TaskName `
  -TaskPath '\' `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Principal $taskPrincipal `
  -Settings $taskSettings `
  -Force | Out-Null

$installedTask = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
$installedAction = @($installedTask.Actions)[0]
if (
  -not $installedAction -or
  -not ([string]$installedAction.Execute).Equals($powershell, [StringComparison]::OrdinalIgnoreCase) -or
  [string]$installedAction.Arguments -notlike "*`"$installedLauncher`"*"
) {
  throw 'The home-server task did not retain the installed source-independent launcher action.'
}

[pscustomobject]@{
  Installed = $true
  Task = "\$TaskName"
  Launcher = $installedLauncher
  Port = $Port
} | ConvertTo-Json -Depth 3
