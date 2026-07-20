function Invoke-EnCroissantGitValue {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $value = & git -C $RepoRoot @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed in $RepoRoot."
  }
  return ([string]$value).Trim()
}

function Get-EnCroissantCanonicalRepoRoot {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $commonGitDirectory = Invoke-EnCroissantGitValue -RepoRoot $RepoRoot -Arguments @(
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  )
  return (Resolve-Path -LiteralPath (Split-Path -Parent $commonGitDirectory)).Path
}

function Enter-EnCroissantPhonePublish {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$TargetName
  )

  $mutex = [System.Threading.Mutex]::new($false, "Global\EnCroissantPhonePublish")
  $acquired = $false
  try {
    try {
      $acquired = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }
    if (-not $acquired) {
      throw "Another phone publish is already running. Refusing to overlap the $TargetName publish."
    }

    $sourceCommit = Invoke-EnCroissantGitValue -RepoRoot $RepoRoot -Arguments @(
      "rev-parse",
      "HEAD"
    )
    $sourceBranch = Invoke-EnCroissantGitValue -RepoRoot $RepoRoot -Arguments @(
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    )
    $trackedChanges = & git -C $RepoRoot status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect the source worktree before publishing."
    }
    if ($trackedChanges) {
      throw "The source worktree has uncommitted tracked changes. Commit them before publishing so the deployed version is reproducible."
    }

    return [pscustomobject]@{
      Mutex = $mutex
      SourceCommit = $sourceCommit
      SourceBranch = $sourceBranch
      CanonicalRepoRoot = Get-EnCroissantCanonicalRepoRoot -RepoRoot $RepoRoot
      TargetName = $TargetName
    }
  } catch {
    if ($acquired) {
      try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
    throw
  }
}

function Exit-EnCroissantPhonePublish {
  param($Context)

  if (-not $Context) { return }
  try {
    $Context.Mutex.ReleaseMutex()
  } finally {
    $Context.Mutex.Dispose()
  }
}

function Read-EnCroissantDeployment {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  } catch {
    throw "Deployment metadata is unreadable at $Path. Refusing to publish over an unknown version."
  }
}

function Assert-EnCroissantPublishDescendsFrom {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$SourceCommit,
    [Parameter(Mandatory = $true)][string]$DeploymentMetadataPath,
    [Parameter(Mandatory = $true)][string]$TargetName
  )

  $deployment = Read-EnCroissantDeployment -Path $DeploymentMetadataPath
  if (-not $deployment) { return }
  $deployedCommit = [string]$deployment.sourceCommit
  if (-not $deployedCommit) {
    throw "$TargetName deployment metadata has no source commit. Refusing an unverifiable overwrite."
  }
  if ($deployedCommit -eq $SourceCommit) { return }

  & git -C $RepoRoot cat-file -e "$deployedCommit`^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "$TargetName currently runs source commit $deployedCommit, which is absent from this checkout. Fetch or integrate that commit before publishing."
  }

  & git -C $RepoRoot merge-base --is-ancestor $deployedCommit $SourceCommit 2>$null
  if ($LASTEXITCODE -eq 0) { return }
  if ($LASTEXITCODE -eq 1) {
    throw "$TargetName currently runs $deployedCommit, but this worktree is $SourceCommit. The new build does not contain the live version, so publishing it would roll back parallel work. Integrate the current deployed commit first."
  }
  throw "Could not verify that $SourceCommit contains the current $TargetName deployment $deployedCommit."
}

function Get-EnCroissantFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-EnCroissantAppShellFiles {
  param([Parameter(Mandatory = $true)][string]$Root)

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  return @(
    Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse |
      ForEach-Object {
        $relativePath = $_.FullName.Substring($resolvedRoot.Length).TrimStart("\", "/")
        $portablePath = $relativePath.Replace("\", "/")
        if ($portablePath -eq "app-version.json") { return }
        if ($portablePath -eq ".nojekyll") { return }
        if ($portablePath.StartsWith("web-library/", [System.StringComparison]::OrdinalIgnoreCase)) {
          return
        }
        [pscustomobject]@{
          path = $portablePath
          bytes = $_.Length
          sha256 = Get-EnCroissantFileSha256 -Path $_.FullName
        }
      } |
      Sort-Object path
  )
}

function Get-EnCroissantAppShellSha256 {
  param([Parameter(Mandatory = $true)]$Files)

  $lines = @($Files | ForEach-Object { "$($_.sha256) $($_.bytes) $($_.path)" })
  $payload = [string]::Join("`n", $lines)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Write-EnCroissantJsonAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $temporaryPath = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $temporaryPath,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
  try {
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Set-EnCroissantPhoneBuildMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$DistRoot,
    [Parameter(Mandatory = $true)]$PublishContext
  )

  $resolvedDist = (Resolve-Path -LiteralPath $DistRoot).Path
  $indexPath = Join-Path $resolvedDist "index.html"
  $serviceWorkerPath = Join-Path $resolvedDist "web-sw.js"
  if (-not (Test-Path -LiteralPath $indexPath)) {
    throw "The phone build has no index.html at $resolvedDist."
  }
  if (-not (Test-Path -LiteralPath $serviceWorkerPath)) {
    throw "The phone build has no web-sw.js at $resolvedDist."
  }

  $serviceWorker = Get-Content -Raw -LiteralPath $serviceWorkerPath
  if ($serviceWorker.Contains("__EN_CROISSANT_BUILD_ID__")) {
    $serviceWorker = $serviceWorker.Replace(
      "__EN_CROISSANT_BUILD_ID__",
      $PublishContext.SourceCommit.Substring(0, 16)
    )
    [System.IO.File]::WriteAllText(
      $serviceWorkerPath,
      $serviceWorker,
      [System.Text.UTF8Encoding]::new($false)
    )
  } elseif (-not $serviceWorker.Contains($PublishContext.SourceCommit.Substring(0, 16))) {
    throw "The service worker was not prepared for a source-specific build ID."
  }

  $files = Get-EnCroissantAppShellFiles -Root $resolvedDist
  $metadata = [ordered]@{
    schemaVersion = 1
    sourceCommit = $PublishContext.SourceCommit
    sourceBranch = $PublishContext.SourceBranch
    builtAt = [DateTime]::UtcNow.ToString("o")
    publisherHost = $env:COMPUTERNAME
    appShellSha256 = Get-EnCroissantAppShellSha256 -Files $files
    files = $files
  }
  Write-EnCroissantJsonAtomically -Path (Join-Path $resolvedDist "app-version.json") -Value $metadata
  return $metadata
}

function Assert-EnCroissantPhoneBuildMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$ExpectedSourceCommit = ""
  )

  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $metadataPath = Join-Path $resolvedRoot "app-version.json"
  $metadata = Read-EnCroissantDeployment -Path $metadataPath
  if (-not $metadata) {
    throw "The phone build has no app-version.json at $resolvedRoot."
  }
  if ($ExpectedSourceCommit -and [string]$metadata.sourceCommit -ne $ExpectedSourceCommit) {
    throw "The phone build belongs to $($metadata.sourceCommit), not $ExpectedSourceCommit. Rebuild before publishing."
  }

  foreach ($file in @($metadata.files)) {
    $relativePath = ([string]$file.path).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path $resolvedRoot $relativePath
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      throw "The phone build is incomplete: $($file.path) is missing."
    }
    $actualHash = Get-EnCroissantFileSha256 -Path $filePath
    if ($actualHash -ne [string]$file.sha256) {
      throw "The phone build is mixed or corrupt: $($file.path) does not match app-version.json."
    }
  }

  $actualShellHash = Get-EnCroissantAppShellSha256 -Files @($metadata.files)
  if ($actualShellHash -ne [string]$metadata.appShellSha256) {
    throw "The phone build manifest is internally inconsistent."
  }
  return $metadata
}
