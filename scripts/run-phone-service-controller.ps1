param([Parameter(Mandatory = $true)][string]$ServerRoot)
$ErrorActionPreference = 'Stop'
$node = Join-Path $ServerRoot 'runtime\node.exe'
$controller = Join-Path $PSScriptRoot 'phone-service-controller.mjs'
$process = Start-Process -FilePath $node `
  -ArgumentList "`"$controller`" `"$ServerRoot`"" `
  -WorkingDirectory $ServerRoot -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $ServerRoot 'controller-stdout.log') `
  -RedirectStandardError (Join-Path $ServerRoot 'controller-stderr.log') `
  -PassThru -Wait
exit $process.ExitCode
