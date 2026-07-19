$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "remote-compute.ps1")
$cargoTargetDir = Get-EnCroissantCargoTargetDirectory -RepoRoot $repoRoot
$iconPath = Join-Path $cargoTargetDir "debug\en-croissant-fork.exe"
$launcherPath = Join-Path $PSScriptRoot "launch-fork.ps1"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "En Croissant Fork.lnk"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$launcherPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
  $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = "Launch En Croissant with automatic gaming-PC compute and local fallback"
$shortcut.Save()

Write-Host "Installed $shortcutPath"
