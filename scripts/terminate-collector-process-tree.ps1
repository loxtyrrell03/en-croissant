param(
  [Parameter(Mandatory = $true)]
  [int]$TargetProcessId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedExecutable,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedJobId
)

$ErrorActionPreference = 'Stop'

if ($TargetProcessId -le 0) {
  throw 'The collector process ID must be positive.'
}
if ($ExpectedJobId -notmatch '^otb-[A-Za-z0-9-]+$') {
  throw 'The collector job ID is invalid.'
}
if (-not [IO.Path]::IsPathRooted($ExpectedExecutable)) {
  throw 'The expected collector executable path must be absolute.'
}

$collector = Get-CimInstance Win32_Process `
  -Filter "ProcessId = $TargetProcessId" `
  -ErrorAction SilentlyContinue
if (-not $collector) {
  exit 0
}

$expectedPath = [IO.Path]::GetFullPath($ExpectedExecutable)
$actualPath = if ($collector.ExecutablePath) {
  [IO.Path]::GetFullPath([string]$collector.ExecutablePath)
} else {
  ''
}
if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
  [Console]::Error.WriteLine("PID $TargetProcessId is not the expected OTB collector executable.")
  exit 20
}

$escapedJobId = [Regex]::Escape($ExpectedJobId)
$jobArgumentPattern = '(?:^|\s)--job-id(?:=|\s+)"?' + $escapedJobId + '"?(?=\s|$)'
if ([string]$collector.CommandLine -notmatch $jobArgumentPattern) {
  [Console]::Error.WriteLine("PID $TargetProcessId is not the collector for job $ExpectedJobId.")
  exit 21
}

& taskkill.exe /PID $TargetProcessId /T /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  $remaining = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $TargetProcessId" `
    -ErrorAction SilentlyContinue
  if ($remaining) {
    throw "Could not terminate the collector process tree for job $ExpectedJobId."
  }
}
