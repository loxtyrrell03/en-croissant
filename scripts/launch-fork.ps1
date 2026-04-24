$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runningFork = Get-Process -Name "en-croissant-fork" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($runningFork) {
  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.AppActivate($runningFork.Id)
  exit 0
}

Start-Process -FilePath "cmd.exe" `
  -WorkingDirectory $repoRoot `
  -WindowStyle Minimized `
  -ArgumentList @(
    "/d",
    "/s",
    "/c",
    "pnpm dev:safe"
  )
