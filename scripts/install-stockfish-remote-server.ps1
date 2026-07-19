param(
  [string]$EnginePath = "",
  [int]$Threads = 16,
  [int]$HashMB = 2048,
  [int]$UciPort = 38418,
  [int]$HttpPort = 38419,
  [int]$HttpsPort = 8443
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "Stockfish18Server"
$serverRoot = Join-Path $installRoot "server"
$serverScript = Join-Path $serverRoot "stockfish-remote-server.mjs"
$localEvalReader = Join-Path $serverRoot "lichess-local-eval-reader.mjs"
$configPath = Join-Path $installRoot "config.json"
$logPath = Join-Path $installRoot "stockfish-remote-server.log"
$node = (Get-Command node -ErrorAction Stop).Source
$tailscale = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"

if (-not $EnginePath) {
  $EnginePath = Join-Path $installRoot "stockfish-bmi2\stockfish\stockfish-windows-x86-64-bmi2.exe"
}
$EnginePath = [IO.Path]::GetFullPath($EnginePath)
if (-not (Test-Path -LiteralPath $EnginePath -PathType Leaf)) {
  throw "Stockfish executable not found: $EnginePath"
}
if (-not (Test-Path -LiteralPath $tailscale -PathType Leaf)) {
  throw "Tailscale CLI not found: $tailscale"
}

New-Item -ItemType Directory -Force -Path $serverRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\stockfish-remote-server.mjs") -Destination $serverScript -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\lichess-local-eval-reader.mjs") -Destination $localEvalReader -Force

$config = [ordered]@{
  enginePath = $EnginePath
  threads = $Threads
  hashMb = $HashMB
  uciHost = "127.0.0.1"
  uciPort = $UciPort
  httpHost = "127.0.0.1"
  httpPort = $HttpPort
  maxDepth = 40
  maxMultiPv = 8
  localEvalPath = (Join-Path $env:APPDATA "org.encroissant.app\lichess-cloud-evals")
  allowedOrigins = @(
    "https://loxtyrrell03.github.io",
    "https://gaming-pc.tail89d19b.ts.net",
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost"
  )
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding utf8

$taskName = "Stockfish18Remote"
$taskPath = "\EnCroissant\"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$serverScript`"" -WorkingDirectory $serverRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Runs the private Stockfish 18 UCI and phone-analysis backend."
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $task -Force | Out-Null

Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$serverScript*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath

& $tailscale serve --bg --yes --tcp $UciPort "tcp://127.0.0.1:$UciPort" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Could not expose the UCI service through Tailscale." }
& $tailscale serve --bg --yes --https $HttpsPort "http://127.0.0.1:$HttpPort" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Could not expose the HTTPS analysis service through Tailscale." }

$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 250
  try {
    $health = Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:$HttpPort/v1/health" -TimeoutSec 2
  } catch {
    $health = $null
  }
} until ($health -or (Get-Date) -ge $deadline)

if (-not $health) {
  throw "Stockfish remote server did not become healthy. See $logPath"
}

[pscustomobject]@{
  ProcessId = $health.processId
  EnginePath = $health.enginePath
  Threads = $health.threads
  HashMB = $health.hashMb
  LocalHealth = "http://127.0.0.1:$HttpPort/v1/health"
  TailnetUci = "gaming-pc.tail89d19b.ts.net:$UciPort"
  TailnetHttps = "https://gaming-pc.tail89d19b.ts.net:$HttpsPort"
  ScheduledTask = "$taskPath$taskName"
} | Format-List
