param([Parameter(Mandatory = $true)][string]$ServerRoot)
$ErrorActionPreference = 'Stop'
$node = Join-Path $ServerRoot 'runtime\node.exe'
$controller = Join-Path $PSScriptRoot 'phone-service-controller.mjs'
$process = Start-Process -FilePath $node `
  -ArgumentList "`"$controller`" `"$ServerRoot`"" `
  -WorkingDirectory $ServerRoot -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $ServerRoot 'controller-stdout.log') `
  -RedirectStandardError (Join-Path $ServerRoot 'controller-stderr.log') `
  -PassThru
# Start-Process -Wait includes descendants on Windows. That would hide a dead
# controller from Scheduler while a detached backend is still alive.
$null = $process.Handle
$process.WaitForExit()
exit $process.ExitCode
