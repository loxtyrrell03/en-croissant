param([Parameter(Mandatory = $true)][string]$HelperExecutable)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'phone-notices.ps1')
function Assert-Throws {
  param([scriptblock]$Action, [string]$Message)
  try { & $Action } catch {
    if ($_.Exception.Message -notlike "*$Message*") { throw }
    return
  }
  throw "Expected refusal containing $Message"
}
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('encroissant-phone-notices-' + [Guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$noticePath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'licenses\PHONE_HELPER_NOTICES.txt'
try {
  $target = Join-Path $testRoot 'helper.NOTICES.txt'
  Copy-EnCroissantImmutableNotice -Source $noticePath -Destination $target
  if ((Get-EnCroissantNoticeHash $target) -cne (Get-EnCroissantNoticeHash $noticePath)) { throw 'Notice copy differs.' }
  $lastWrite = [System.IO.File]::GetLastWriteTimeUtc($target)
  $oldModulePreference = $PSModuleAutoLoadingPreference
  try {
    $PSModuleAutoLoadingPreference = 'None'
    Copy-EnCroissantImmutableNotice -Source $noticePath -Destination $target
  } finally { $PSModuleAutoLoadingPreference = $oldModulePreference }
  if ([System.IO.File]::GetLastWriteTimeUtc($target) -ne $lastWrite) { throw 'Identical immutable notice was rewritten.' }
  $changed = Join-Path $testRoot 'changed.txt'
  [System.IO.File]::WriteAllText($changed, 'different')
  Assert-Throws -Message 'contents were kept' -Action { Copy-EnCroissantImmutableNotice -Source $changed -Destination $target }
  if ((Get-EnCroissantNoticeHash $target) -cne (Get-EnCroissantNoticeHash $noticePath)) { throw 'Conflict changed existing text.' }
  $missingTarget = Join-Path $testRoot 'missing.NOTICES.txt'
  Assert-Throws -Message 'Could not find file' -Action { Copy-EnCroissantImmutableNotice -Source (Join-Path $testRoot 'missing.txt') -Destination $missingTarget }
  if ([System.IO.File]::Exists($missingTarget)) { throw 'Missing source published a notice.' }
  Assert-EnCroissantHelperNotices -ExecutablePath $HelperExecutable -NoticePath $noticePath
  Assert-Throws -Message 'matching complete notices' -Action { Assert-EnCroissantHelperNotices -ExecutablePath $HelperExecutable -NoticePath $changed }
  if (@([System.IO.Directory]::GetFiles($testRoot, '*.next-*')).Count) { throw 'Owned staging files were retained.' }
  Write-Host 'phone notice tests passed: 6 cases'
} finally {
  $actual = [System.IO.Path]::GetFullPath($testRoot)
  $parent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
  if ([System.IO.Directory]::GetParent($actual).FullName -ne $parent -or [System.IO.Path]::GetFileName($actual) -notlike 'encroissant-phone-notices-*') { throw 'Refusing cleanup outside the exact fixture directory.' }
  Remove-Item -LiteralPath $actual -Recurse -Force
}
