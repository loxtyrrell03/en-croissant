param(
  [string]$SourceDir = "",
  [string]$PagesRepo = "",
  [int]$DebounceSeconds = 90,
  [int]$PeriodicMinutes = 30,
  [int]$MaxDatabaseMB = 200,
  [switch]$SkipDatabaseExports,
  [switch]$RunInitial
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$publishScript = Join-Path $scriptRoot "publish-web-site.ps1"
$logRoot = Join-Path $env:LOCALAPPDATA "EnCroissantWebSync"
$logFile = Join-Path $logRoot "watch.log"

New-Item -Path $logRoot -ItemType Directory -Force | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

function Resolve-OptionalDirectory {
  param([string]$Path)
  if (-not $Path) { return $null }
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Test-RelevantPath {
  param([string]$Path)
  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  return $extension -in @(".pgn", ".pdf", ".db3")
}

function Invoke-Publish {
  param([string]$Reason)

  Write-Log "publish start: $Reason"
  try {
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $publishScript)
    if ($script:SourceDir) { $arguments += @("-SourceDir", $script:SourceDir) }
    if ($script:PagesRepo) { $arguments += @("-PagesRepo", $script:PagesRepo) }
    if ($script:MaxDatabaseMB -gt 0) { $arguments += @("-MaxDatabaseMB", $script:MaxDatabaseMB) }
    if ($script:SkipDatabaseExports) { $arguments += "-SkipDatabaseExports" }
    & powershell.exe @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "publish exited with code $LASTEXITCODE"
    }
    Write-Log "publish complete"
  } catch {
    Write-Log "publish failed: $($_.Exception.Message)"
  }
}

function New-Watcher {
  param(
    [string]$Path,
    [string]$Name
  )

  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $Path
  $watcher.IncludeSubdirectories = $true
  $watcher.NotifyFilter = [System.IO.NotifyFilters]"FileName, DirectoryName, LastWrite, Size"
  $watcher.Filter = "*.*"
  $watcher.EnableRaisingEvents = $true

  foreach ($eventName in @("Created", "Changed", "Deleted", "Renamed")) {
    Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier "EnCroissantWebSync.$Name.$eventName" | Out-Null
  }

  return $watcher
}

if (-not $SourceDir) {
  $SourceDir = if ($env:EN_CROISSANT_WEB_FILES_DIR) {
    $env:EN_CROISSANT_WEB_FILES_DIR
  } else {
    Join-Path $env:USERPROFILE "Documents\EnCroissant"
  }
}

if (-not $PagesRepo) {
  $PagesRepo = if ($env:EN_CROISSANT_PAGES_REPO) {
    $env:EN_CROISSANT_PAGES_REPO
  } else {
    Join-Path $logRoot "loxtyrrell03.github.io"
  }
}

$SourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
$PagesRepo = $PagesRepo
$databaseWatchRoots = @(
  (Resolve-OptionalDirectory (Join-Path $env:APPDATA "org.encroissant.app\db")),
  (Resolve-OptionalDirectory (Join-Path $env:APPDATA "org.encroissant.fork\db"))
) | Where-Object { $_ } | Select-Object -Unique

Write-Log "watching files: $SourceDir"
foreach ($dbRoot in $databaseWatchRoots) {
  Write-Log "watching database changes: $dbRoot"
}

$watchers = @()
$watchers += New-Watcher -Path $SourceDir -Name "files"
$index = 0
foreach ($dbRoot in $databaseWatchRoots) {
  $index += 1
  $watchers += New-Watcher -Path $dbRoot -Name "db$index"
}

if ($RunInitial) {
  Invoke-Publish "initial sync"
}

$pendingReason = $null
$nextPublishAt = $null
$nextPeriodicAt = (Get-Date).AddMinutes($PeriodicMinutes)

try {
  while ($true) {
    $event = Wait-Event -Timeout 5
    if ($event) {
      $path = $event.SourceEventArgs.FullPath
      Remove-Event -EventIdentifier $event.EventIdentifier
      if ($path -and (Test-RelevantPath $path)) {
        $pendingReason = "changed $([System.IO.Path]::GetFileName($path))"
        $nextPublishAt = (Get-Date).AddSeconds($DebounceSeconds)
        Write-Log "queued sync: $pendingReason"
      }
    }

    $now = Get-Date
    if ($nextPublishAt -and $now -ge $nextPublishAt) {
      $reason = $pendingReason
      $pendingReason = $null
      $nextPublishAt = $null
      Invoke-Publish $reason
      $nextPeriodicAt = (Get-Date).AddMinutes($PeriodicMinutes)
    }

    if ($PeriodicMinutes -gt 0 -and $now -ge $nextPeriodicAt) {
      Invoke-Publish "periodic sync"
      $nextPeriodicAt = (Get-Date).AddMinutes($PeriodicMinutes)
    }
  }
} finally {
  foreach ($watcher in $watchers) {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
  }
}
