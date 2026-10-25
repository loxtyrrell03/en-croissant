# Private publisher helpers. These never change service state or owner databases.
function Assert-EnCroissantHelperNotices {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$NoticePath,
    [int]$TimeoutMs = 5000
  )
  $encoding = [System.Text.UTF8Encoding]::new($false, $true)
  $expected = [System.IO.File]::ReadAllText($NoticePath, $encoding)
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $ExecutablePath
  $start.Arguments = '--third-party-notices'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = $encoding
  $start.StandardErrorEncoding = $encoding
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  $elapsed = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    if (-not $process.Start()) { throw 'Could not verify the helper notices.' }
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMs)) {
      $process.Kill()
      $process.WaitForExit()
      throw 'Helper notice verification timed out.'
    }
    if (-not $output.Wait([Math]::Max(0, $TimeoutMs - [int]$elapsed.ElapsedMilliseconds)) -or
        -not $errors.Wait([Math]::Max(0, $TimeoutMs - [int]$elapsed.ElapsedMilliseconds))) {
      throw 'Helper notice output did not close within the verification deadline.'
    }
    if ($process.ExitCode -ne 0 -or $output.GetAwaiter().GetResult() -cne $expected) {
      throw 'The compiled helper does not include the matching complete notices.'
    }
    if ($errors.GetAwaiter().GetResult().Length) { throw 'Helper notice verification reported an error.' }
  } finally { $process.Dispose() }
}

function Get-EnCroissantNoticeHash {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Dispose() }
}

function Copy-EnCroissantImmutableNotice {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $expected = Get-EnCroissantNoticeHash -Path $Source
  if (Test-Path -LiteralPath $Destination) {
    if ((Get-EnCroissantNoticeHash -Path $Destination) -cne $expected) {
      throw 'An immutable helper notice differs from this release. Its contents were kept.'
    }
    return
  }
  $pending = "$Destination.next-$([Guid]::NewGuid().ToString('N'))"
  try {
    [System.IO.File]::Copy($Source, $pending, $false)
    if ((Get-EnCroissantNoticeHash -Path $pending) -cne $expected) { throw 'Notice copy verification failed.' }
    [System.IO.File]::Move($pending, $Destination)
  } finally {
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
  }
}
