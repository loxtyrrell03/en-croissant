$script:EnCroissantRemoteHost = "gaming-pc-compute"
$script:EnCroissantRemoteWorkerWindowsRoot = "C:\Users\loxty\AppData\Local\EnCroissantRemoteCompute"
$script:EnCroissantRemoteWorkerSftpRoot = "C:/Users/loxty/AppData/Local/EnCroissantRemoteCompute"
$script:EnCroissantRemoteAvailability = $null

function Get-EnCroissantCargoTargetDirectory {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $configured = $env:CARGO_TARGET_DIR
  if ([string]::IsNullOrWhiteSpace($configured)) {
    $configured = [Environment]::GetEnvironmentVariable("CARGO_TARGET_DIR", "User")
  }

  if ([string]::IsNullOrWhiteSpace($configured)) {
    return Join-Path $RepoRoot "src-tauri\target"
  }

  $configured = [Environment]::ExpandEnvironmentVariables($configured.Trim())
  if ([IO.Path]::IsPathRooted($configured)) {
    return [IO.Path]::GetFullPath($configured)
  }

  return [IO.Path]::GetFullPath((Join-Path $RepoRoot $configured))
}

function Test-EnCroissantRemoteComputeAvailable {
  param([switch]$Refresh)

  if (-not $Refresh -and $null -ne $script:EnCroissantRemoteAvailability) {
    return [bool]$script:EnCroissantRemoteAvailability
  }

  try {
    & ssh.exe -n -T -o BatchMode=yes -o ConnectTimeout=3 $script:EnCroissantRemoteHost hostname *> $null
    $script:EnCroissantRemoteAvailability = $LASTEXITCODE -eq 0
  }
  catch {
    $script:EnCroissantRemoteAvailability = $false
  }

  return [bool]$script:EnCroissantRemoteAvailability
}

function Invoke-EnCroissantRemotePowerShell {
  param([Parameter(Mandatory = $true)][string]$Script)

  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
  & ssh.exe -n -T -o BatchMode=yes -o ConnectTimeout=5 `
    $script:EnCroissantRemoteHost powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Remote command on $($script:EnCroissantRemoteHost) failed with exit code $exitCode."
  }
}

function Initialize-EnCroissantRemoteWorker {
  $remoteScript = @'
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$workerRoot = "__WORKER_ROOT__"
New-Item -ItemType Directory -Force -Path $workerRoot | Out-Null
'@.Replace("__WORKER_ROOT__", $script:EnCroissantRemoteWorkerWindowsRoot)

  Invoke-EnCroissantRemotePowerShell -Script $remoteScript | Out-Null
}

function Invoke-EnCroissantRemoteNativeBuild {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$DestinationExe,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if (-not (Test-EnCroissantRemoteComputeAvailable)) {
    return $false
  }

  Initialize-EnCroissantRemoteWorker
  $archivePath = Join-Path $env:TEMP "en-croissant-remote-source-$([Guid]::NewGuid().ToString('N')).tar"
  $downloadPath = Join-Path $env:TEMP "en-croissant-remote-build-$([Guid]::NewGuid().ToString('N')).exe"

  try {
    Push-Location $RepoRoot
    try {
      & tar.exe -cf $archivePath `
        --exclude="src-tauri/target" `
        --exclude="src-tauri/gen" `
        src-tauri sound
      if ($LASTEXITCODE -ne 0) {
        throw "Could not package the native En Croissant sources for the gaming PC."
      }
    }
    finally {
      Pop-Location
    }

    $remoteArchive = "$($script:EnCroissantRemoteHost):$($script:EnCroissantRemoteWorkerSftpRoot)/source.tar"
    & scp.exe -q -o BatchMode=yes -o ConnectTimeout=5 $archivePath $remoteArchive
    if ($LASTEXITCODE -ne 0) {
      throw "Could not send the native En Croissant sources to the gaming PC."
    }

    $remoteScript = @'
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$workerRoot = "__WORKER_ROOT__"
$sourceRoot = Join-Path $workerRoot "source"
$archivePath = Join-Path $workerRoot "source.tar"
$targetRoot = Join-Path $workerRoot "target"
$buildMutex = New-Object System.Threading.Mutex($false, "Local\EnCroissantRemoteNativeBuild")
$hasBuildLock = $buildMutex.WaitOne(0)
if (-not $hasBuildLock) {
  throw "Another En Croissant native build is already running on the gaming PC."
}

try {
  $expectedSource = Join-Path $workerRoot "source"
  if (-not $sourceRoot.Equals($expectedSource, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace an unexpected remote source directory: $sourceRoot"
  }
  if (Test-Path -LiteralPath $sourceRoot) {
    Remove-Item -LiteralPath $sourceRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $sourceRoot,$targetRoot | Out-Null

  & tar.exe -xf $archivePath -C $sourceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Could not extract the En Croissant source archive."
  }
  Remove-Item -LiteralPath $archivePath -Force

  $env:CARGO_TARGET_DIR = $targetRoot
  $env:CARGO_PROFILE_DEV_DEBUG = "0"
  Set-Location $sourceRoot
  & cargo.exe build --manifest-path src-tauri/Cargo.toml --no-default-features --bin en-croissant-fork
  if ($LASTEXITCODE -ne 0) {
    throw "The En Croissant native build failed on the gaming PC."
  }

  $artifact = Join-Path $targetRoot "debug\en-croissant-fork.exe"
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "The gaming PC build did not produce $artifact"
  }
}
finally {
  if ($hasBuildLock) {
    try { $buildMutex.ReleaseMutex() | Out-Null } catch {}
  }
  $buildMutex.Dispose()
}
'@.Replace("__WORKER_ROOT__", $script:EnCroissantRemoteWorkerWindowsRoot)

    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Building native En Croissant code on $($script:EnCroissantRemoteHost)." | `
      Add-Content -LiteralPath $LogPath
    Invoke-EnCroissantRemotePowerShell -Script $remoteScript 2>&1 | Tee-Object -FilePath $LogPath -Append | Out-Host

    $remoteArtifact = "$($script:EnCroissantRemoteHost):$($script:EnCroissantRemoteWorkerSftpRoot)/target/debug/en-croissant-fork.exe"
    & scp.exe -q -o BatchMode=yes -o ConnectTimeout=5 $remoteArtifact $downloadPath
    if ($LASTEXITCODE -ne 0) {
      throw "Could not copy the gaming PC build back to this computer."
    }

    if (-not (Test-Path -LiteralPath $downloadPath -PathType Leaf) -or (Get-Item -LiteralPath $downloadPath).Length -lt 1MB) {
      throw "The gaming PC returned an invalid En Croissant executable."
    }

    $destinationDir = Split-Path -Parent $DestinationExe
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Move-Item -LiteralPath $downloadPath -Destination $DestinationExe -Force
    return $true
  }
  finally {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
  }
}

function Find-EnCroissantLocalStockfish {
  param([Parameter(Mandatory = $true)][string]$SharedDataRoot)

  $preferred = Join-Path $SharedDataRoot "engines\stockfish\stockfish-windows-x86-64-avx2.exe"
  if (Test-Path -LiteralPath $preferred -PathType Leaf) {
    return $preferred
  }

  $enginesRoot = Join-Path $SharedDataRoot "engines"
  if (-not (Test-Path -LiteralPath $enginesRoot -PathType Container)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $enginesRoot -Recurse -File -Filter "*stockfish*.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -ExpandProperty FullName -First 1
}

function Enable-EnCroissantRemoteEngineCompute {
  param(
    [Parameter(Mandatory = $true)][string]$SharedDataRoot,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if (-not (Test-EnCroissantRemoteComputeAvailable)) {
    return $false
  }

  $localEngine = Find-EnCroissantLocalStockfish -SharedDataRoot $SharedDataRoot
  if ([string]::IsNullOrWhiteSpace($localEngine)) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] No local Stockfish executable was found to provision on the gaming PC." |
      Add-Content -LiteralPath $LogPath
    return $false
  }

  Initialize-EnCroissantRemoteWorker
  $localLength = (Get-Item -LiteralPath $localEngine).Length
  $remoteEngineWindows = Join-Path $script:EnCroissantRemoteWorkerWindowsRoot "stockfish.exe"
  $remoteLengthScript = @'
$path = "__REMOTE_ENGINE__"
if (Test-Path -LiteralPath $path -PathType Leaf) {
  "REMOTE_ENGINE_LENGTH=$((Get-Item -LiteralPath $path).Length)"
} else {
  "REMOTE_ENGINE_LENGTH=0"
}
'@.Replace("__REMOTE_ENGINE__", $remoteEngineWindows)
  $remoteLengthOutput = @(Invoke-EnCroissantRemotePowerShell -Script $remoteLengthScript 2>$null)
  $remoteLengthLine = $remoteLengthOutput | Where-Object { $_ -match '^REMOTE_ENGINE_LENGTH=\d+$' } | Select-Object -Last 1
  $remoteLength = if ($remoteLengthLine) { [int64]($remoteLengthLine -replace '^REMOTE_ENGINE_LENGTH=', '') } else { 0 }

  if ($remoteLength -ne $localLength) {
    $remoteUploadSftp = "$($script:EnCroissantRemoteWorkerSftpRoot)/stockfish.upload.exe"
    & scp.exe -q -o BatchMode=yes -o ConnectTimeout=5 `
      $localEngine "$($script:EnCroissantRemoteHost):$remoteUploadSftp"
    if ($LASTEXITCODE -ne 0) {
      throw "Could not provision Stockfish on the gaming PC."
    }

    $remoteInstallScript = @'
$ErrorActionPreference = "Stop"
$upload = "__UPLOAD__"
$destination = "__DESTINATION__"
$expectedLength = __EXPECTED_LENGTH__
if (-not (Test-Path -LiteralPath $upload -PathType Leaf)) {
  throw "The uploaded Stockfish executable is missing."
}
if ((Get-Item -LiteralPath $upload).Length -ne $expectedLength) {
  throw "The uploaded Stockfish executable is incomplete."
}
Move-Item -LiteralPath $upload -Destination $destination -Force
'@.Replace("__UPLOAD__", (Join-Path $script:EnCroissantRemoteWorkerWindowsRoot "stockfish.upload.exe")).
    Replace("__DESTINATION__", $remoteEngineWindows).
    Replace("__EXPECTED_LENGTH__", [string]$localLength)
    Invoke-EnCroissantRemotePowerShell -Script $remoteInstallScript | Out-Null
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Provisioned Stockfish on $($script:EnCroissantRemoteHost)." |
      Add-Content -LiteralPath $LogPath
  }

  $env:EN_CROISSANT_REMOTE_COMPUTE_HOST = $script:EnCroissantRemoteHost
  $env:EN_CROISSANT_REMOTE_ENGINE_PATH = "$($script:EnCroissantRemoteWorkerSftpRoot)/stockfish.exe"
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Stockfish jobs will run on $($script:EnCroissantRemoteHost)." |
    Add-Content -LiteralPath $LogPath
  return $true
}
