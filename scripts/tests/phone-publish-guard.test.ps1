$ErrorActionPreference = "Stop"
. (Join-Path (Split-Path -Parent $PSScriptRoot) "phone-publish-guard.ps1")

function Invoke-TestGit {
  param([string]$Repo, [string[]]$Arguments)
  & git -C $Repo @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Test git command failed: git $($Arguments -join ' ')"
  }
}

function Assert-Throws {
  param([scriptblock]$Action, [string]$ExpectedMessage)
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
      throw "Expected an error containing '$ExpectedMessage', got '$($_.Exception.Message)'."
    }
    return
  }
  throw "Expected an error containing '$ExpectedMessage', but the action succeeded."
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("en-croissant-publish-guard-" + [Guid]::NewGuid().ToString("N"))
$repoRoot = Join-Path $testRoot "repo"
$buildRoot = Join-Path $testRoot "build"
New-Item -ItemType Directory -Path $repoRoot, (Join-Path $buildRoot "assets") -Force | Out-Null

try {
  Invoke-TestGit -Repo $repoRoot -Arguments @("init", "--initial-branch=main")
  Invoke-TestGit -Repo $repoRoot -Arguments @("config", "user.email", "test@example.invalid")
  Invoke-TestGit -Repo $repoRoot -Arguments @("config", "user.name", "Publish Guard Test")
  [System.IO.File]::WriteAllText((Join-Path $repoRoot "tracked.txt"), "base")
  Invoke-TestGit -Repo $repoRoot -Arguments @("add", "tracked.txt")
  Invoke-TestGit -Repo $repoRoot -Arguments @("commit", "-m", "base")
  $baseCommit = Invoke-EnCroissantGitValue -RepoRoot $repoRoot -Arguments @("rev-parse", "HEAD")

  [System.IO.File]::WriteAllText((Join-Path $repoRoot "tracked.txt"), "newer")
  Invoke-TestGit -Repo $repoRoot -Arguments @("add", "tracked.txt")
  Invoke-TestGit -Repo $repoRoot -Arguments @("commit", "-m", "newer")
  $newerCommit = Invoke-EnCroissantGitValue -RepoRoot $repoRoot -Arguments @("rev-parse", "HEAD")

  $deploymentPath = Join-Path $testRoot "active-app.json"
  Write-EnCroissantJsonAtomically -Path $deploymentPath -Value @{ sourceCommit = $newerCommit }
  Assert-Throws -ExpectedMessage "would roll back parallel work" -Action {
    Assert-EnCroissantPublishDescendsFrom `
      -RepoRoot $repoRoot `
      -SourceCommit $baseCommit `
      -DeploymentMetadataPath $deploymentPath `
      -TargetName "test deployment"
  }

  Write-EnCroissantJsonAtomically -Path $deploymentPath -Value @{ sourceCommit = $baseCommit }
  Assert-EnCroissantPublishDescendsFrom `
    -RepoRoot $repoRoot `
    -SourceCommit $newerCommit `
    -DeploymentMetadataPath $deploymentPath `
    -TargetName "test deployment"

  [System.IO.File]::WriteAllText((Join-Path $buildRoot "index.html"), "<script src=`"/assets/app.js`"></script>")
  [System.IO.File]::WriteAllText((Join-Path $buildRoot "assets\app.js"), "console.log('current');")
  [System.IO.File]::WriteAllText(
    (Join-Path $buildRoot "web-sw.js"),
    'const BUILD_ID = "__EN_CROISSANT_BUILD_ID__";'
  )
  $context = [pscustomobject]@{
    SourceCommit = $newerCommit
    SourceBranch = "main"
  }
  Set-EnCroissantPhoneBuildMetadata -DistRoot $buildRoot -PublishContext $context | Out-Null
  Assert-EnCroissantPhoneBuildMetadata -Root $buildRoot -ExpectedSourceCommit $newerCommit | Out-Null
  $stampedWorker = Get-Content -Raw -LiteralPath (Join-Path $buildRoot "web-sw.js")
  if (-not $stampedWorker.Contains($newerCommit.Substring(0, 16))) {
    throw "The service worker did not receive the source-specific build ID."
  }

  [System.IO.File]::WriteAllText((Join-Path $buildRoot "assets\app.js"), "console.log('stale');")
  Assert-Throws -ExpectedMessage "mixed or corrupt" -Action {
    Assert-EnCroissantPhoneBuildMetadata -Root $buildRoot | Out-Null
  }

  [System.IO.File]::WriteAllText((Join-Path $repoRoot "tracked.txt"), "dirty")
  Assert-Throws -ExpectedMessage "uncommitted tracked changes" -Action {
    Enter-EnCroissantPhonePublish -RepoRoot $repoRoot -TargetName "dirty test" | Out-Null
  }

  $unchangedContext = [pscustomobject]@{ SourceCommit = $newerCommit }
  Assert-Throws -ExpectedMessage "Tracked source files changed" -Action {
    Assert-EnCroissantPublishSourceUnchanged `
      -RepoRoot $repoRoot `
      -PublishContext $unchangedContext
  }

  Write-Host "phone publish guard tests passed"
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
