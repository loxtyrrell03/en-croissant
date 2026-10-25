param(
  [Parameter(Mandatory = $true)][string]$Node,
  [Parameter(Mandatory = $true)][string]$Config
)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
if ($settings.enabled -ne $true) { exit 0 }
$entrypoint = Join-Path $PSScriptRoot 'runner.mjs'
$arguments = @(('"{0}"' -f $entrypoint), ('"{0}"' -f $Config))
$process = Start-Process -FilePath $Node -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru `
  -RedirectStandardOutput (Join-Path $settings.stateRoot 'runner.stdout.log') `
  -RedirectStandardError (Join-Path $settings.stateRoot 'runner.stderr.log')
exit $process.ExitCode
