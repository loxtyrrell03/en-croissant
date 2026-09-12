param(
  [int]$Port = 8787,
  [int]$ControllerPort = 8786,
  [string]$TaskName = 'EnCroissantHomeServer',
  [string]$ServerRoot = ''
)
$ErrorActionPreference = 'Stop'
if (-not $ServerRoot) { $ServerRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer' }
$ServerRoot = [IO.Path]::GetFullPath($ServerRoot)
$launcherRoot = Join-Path $ServerRoot 'launcher'
$installedLauncher = Join-Path $launcherRoot 'run-installed-home-server.ps1'
New-Item -ItemType Directory -Path $launcherRoot -Force | Out-Null
foreach ($name in @('run-installed-home-server.ps1', 'phone-service-controller.mjs', 'manage-phone-services.ps1', 'run-phone-service-controller.ps1')) {
  $destination = Join-Path $launcherRoot $name
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination "$destination.next-$PID" -Force
  Move-Item -LiteralPath "$destination.next-$PID" -Destination $destination -Force
}
$origins = @('https://lox-pc.tail89d19b.ts.net', 'https://windows-t8v5137.tail89d19b.ts.net', 'https://lox-1.tail89d19b.ts.net')
$tailStatus = & (Get-Command tailscale.exe -ErrorAction Stop).Source status --json | ConvertFrom-Json
if ($tailStatus.Self.DNSName) { $origins += 'https://' + $tailStatus.Self.DNSName.TrimEnd('.') }
$origins += @(([Environment]::GetEnvironmentVariable('EN_CROISSANT_PRIVATE_ORIGINS', 'User') -split '[,;\r\n]') | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ })
$config = @{ port = $ControllerPort; homePort = $Port; origins = @($origins | Select-Object -Unique) }
[IO.File]::WriteAllText((Join-Path $launcherRoot 'controller-config.json'), ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

# WScript has no console; it waits for the complete process lifetime so Scheduler
# can recover a failed controller. PS and Node children are hidden as well.
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$controllerRunner = Join-Path $launcherRoot 'run-phone-service-controller.ps1'
$controllerVbs = Join-Path $launcherRoot 'phone-service-controller.vbs'
$command = '"' + $powershell + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $controllerRunner + '" -ServerRoot "' + $ServerRoot + '"'
[IO.File]::WriteAllText($controllerVbs, ('Set shell = CreateObject("WScript.Shell")' + "`r`nWScript.Quit shell.Run(" + '"' + $command.Replace('"', '""') + '", 0, True)' + "`r`n"), [Text.Encoding]::ASCII)
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$controllerVbs`""
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$taskSettings.Priority = 4
Stop-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null

# Preserve the engine task's installed executable, user and recovery settings;
# replace only its console-bearing action with a hidden, waiting wrapper.
$engineTask = Get-ScheduledTask -TaskName 'Stockfish18Remote' -TaskPath '\EnCroissant\' -ErrorAction Stop
$engineAction = @($engineTask.Actions)[0]
$engineVbs = Join-Path $launcherRoot 'phone-engine-service.vbs'
if ([IO.Path]::GetFileName($engineAction.Execute) -ieq 'node.exe') {
  $engineCommand = '"' + $engineAction.Execute + '" ' + $engineAction.Arguments
  [IO.File]::WriteAllText($engineVbs, ('Set shell = CreateObject("WScript.Shell")' + "`r`nWScript.Quit shell.Run(" + '"' + $engineCommand.Replace('"', '""') + '", 0, True)' + "`r`n"), [Text.Encoding]::ASCII)
  $hiddenEngine = New-ScheduledTaskAction -Execute $wscript -Argument "//B //Nologo `"$engineVbs`"" -WorkingDirectory $engineAction.WorkingDirectory
  Set-ScheduledTask -TaskName $engineTask.TaskName -TaskPath $engineTask.TaskPath -Action $hiddenEngine | Out-Null
} elseif ([string]$engineAction.Arguments -notlike "*`"$engineVbs`"*") {
  throw 'The engine task has an unrecognized launcher; its action was preserved.'
}
Start-ScheduledTask -TaskName $TaskName -TaskPath '\'
$installedAction = @((Get-ScheduledTask -TaskName $TaskName -TaskPath '\').Actions)[0]
if ($installedAction.Execute -ne $wscript -or $installedAction.Arguments -notlike "*`"$controllerVbs`"*") {
  throw 'The installed controller task did not retain its headless launcher.'
}
[pscustomobject]@{ Installed = $true; Task = "\$TaskName"; Launcher = $installedLauncher; Port = $Port; ControllerPort = $ControllerPort } | ConvertTo-Json
