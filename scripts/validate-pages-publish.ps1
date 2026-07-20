param(
  [Parameter(Mandatory = $true)][string]$SourceRepo
)

$ErrorActionPreference = "Stop"
$pagesRoot = (Get-Location).Path
$guardScript = Join-Path $SourceRepo "scripts\phone-publish-guard.ps1"
if (-not (Test-Path -LiteralPath $guardScript)) {
  throw "The En Croissant publish validator is missing at $guardScript."
}
. $guardScript

$metadata = Assert-EnCroissantPhoneBuildMetadata -Root $pagesRoot
$previousJson = & git -C $pagesRoot show "origin/main:app-version.json" 2>$null
if ($LASTEXITCODE -ne 0 -or -not $previousJson) {
  Write-Host "En Croissant Pages guard: first versioned publish accepted."
  exit 0
}

try {
  $previous = ([string]::Join("`n", @($previousJson))) | ConvertFrom-Json
} catch {
  throw "The currently published Pages deployment metadata is unreadable."
}

$previousCommit = [string]$previous.sourceCommit
$nextCommit = [string]$metadata.sourceCommit
if (-not $previousCommit -or -not $nextCommit) {
  throw "Pages deployment metadata is missing its source commit."
}
if ($previousCommit -eq $nextCommit) {
  Write-Host "En Croissant Pages guard: same-source rebuild accepted."
  exit 0
}

& git -C $SourceRepo cat-file -e "$previousCommit`^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "The live Pages source commit $previousCommit is absent locally. Fetch it before publishing."
}
& git -C $SourceRepo merge-base --is-ancestor $previousCommit $nextCommit 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "En Croissant Pages guard: fast-forward app deployment accepted."
  exit 0
}
if ($LASTEXITCODE -eq 1) {
  throw "Publishing $nextCommit would roll Pages back from $previousCommit. Integrate the live source commit first."
}
throw "Could not verify Pages source ancestry."
