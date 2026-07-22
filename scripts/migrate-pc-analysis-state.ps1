param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Export', 'Import')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$BundlePath,

  [switch]$IncludeCredentials,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Get-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
}

function Copy-Directory([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    return $false
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE while copying '$Source'."
  }
  return $true
}

function Test-DirectoryEmpty([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return $true
  }
  return $null -eq (Get-ChildItem -LiteralPath $Path -Force | Select-Object -First 1)
}

$bundleRoot = Get-FullPath $BundlePath
$roamingRoot = Join-Path $env:APPDATA 'org.encroissant.app'
$homeServerRoot = Join-Path $env:LOCALAPPDATA 'EnCroissantHomeServer'
$documentsRoot = [Environment]::GetFolderPath('MyDocuments')

$items = @(
  [ordered]@{
    Name = 'stored-evaluations'
    BundleRelativePath = 'app-data\lichess-cloud-evals'
    MachinePath = Join-Path $roamingRoot 'lichess-cloud-evals'
  },
  [ordered]@{
    Name = 'analysis-databases'
    BundleRelativePath = 'app-data\db'
    MachinePath = Join-Path $roamingRoot 'db'
  },
  [ordered]@{
    Name = 'pgn-and-coach-library'
    BundleRelativePath = 'documents\EnCroissant'
    MachinePath = Join-Path $documentsRoot 'EnCroissant'
  },
  [ordered]@{
    Name = 'phone-coach-state'
    BundleRelativePath = 'home-server\state'
    MachinePath = Join-Path $homeServerRoot 'state'
  }
)

if ($IncludeCredentials) {
  $items += [ordered]@{
    Name = 'private-phone-credentials'
    BundleRelativePath = 'home-server\credentials'
    MachinePath = Join-Path $homeServerRoot 'credentials'
  }
}

if ($Mode -eq 'Export') {
  New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
  $copied = @()

  foreach ($item in $items) {
    $destination = Join-Path $bundleRoot $item.BundleRelativePath
    Write-Host "Exporting $($item.Name)..."
    if (Copy-Directory $item.MachinePath $destination) {
      $files = Get-ChildItem -LiteralPath $item.MachinePath -Recurse -File -ErrorAction Stop
      $copied += [ordered]@{
        name = $item.Name
        bundleRelativePath = $item.BundleRelativePath
        fileCount = @($files).Count
        bytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
      }
    } else {
      Write-Warning "Skipped missing directory: $($item.MachinePath)"
    }
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    exportedAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceComputer = $env:COMPUTERNAME
    includesCredentials = [bool]$IncludeCredentials
    items = $copied
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundleRoot 'analysis-state-manifest.json') -Encoding UTF8
  Write-Host "Analysis migration bundle created at '$bundleRoot'."
  exit 0
}

$manifestPath = Join-Path $bundleRoot 'analysis-state-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "No analysis-state-manifest.json was found in '$bundleRoot'."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) {
  throw "Unsupported analysis-state bundle schema version '$($manifest.schemaVersion)'."
}

foreach ($item in $items) {
  $source = Join-Path $bundleRoot $item.BundleRelativePath
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    Write-Warning "Bundle does not contain $($item.Name); skipping it."
    continue
  }
  if (-not $Force -and -not (Test-DirectoryEmpty $item.MachinePath)) {
    throw "Refusing to merge into non-empty '$($item.MachinePath)'. Re-run with -Force after verifying the target."
  }
  Write-Host "Importing $($item.Name)..."
  [void](Copy-Directory $source $item.MachinePath)
}

Write-Host 'Analysis state import completed. Re-run the repository install scripts to recreate services and machine-specific Stockfish paths.'
