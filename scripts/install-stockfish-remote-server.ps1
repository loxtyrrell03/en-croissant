param(
  [string]$EnginePath = "",
  [int]$Threads = 16,
  [int]$HashMB = 512,
  [int]$UciPort = 38418,
  [int]$HttpPort = 38419,
  [int]$HttpsPort = 8443,
  [string]$UciHost = "",
  [string]$NodePath = "",
  [string]$Lc0Path = "",
  [string]$Lc0Bt4Weights = "",
  [string]$Lc0T1Weights = "",
  [string]$Lc0LqoWeights = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA "Stockfish18Server"
$serverRoot = Join-Path $installRoot "server"
$serverScript = Join-Path $serverRoot "stockfish-remote-server.mjs"
$localEvalReader = Join-Path $serverRoot "lichess-local-eval-reader.mjs"
$lc0NetworkRouting = Join-Path $serverRoot "lc0-network-routing.mjs"
$configPath = Join-Path $installRoot "config.json"
$logPath = Join-Path $installRoot "stockfish-remote-server.log"
$existingConfig = if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
} else {
  $null
}
if ($existingConfig) {
  if (-not $PSBoundParameters.ContainsKey("Threads") -and $existingConfig.threads) {
    $Threads = [int]$existingConfig.threads
  }
  if (-not $PSBoundParameters.ContainsKey("HashMB") -and $existingConfig.hashMb) {
    $HashMB = [int]$existingConfig.hashMb
  }
  if (-not $PSBoundParameters.ContainsKey("UciPort") -and $existingConfig.uciPort) {
    $UciPort = [int]$existingConfig.uciPort
  }
  if (-not $PSBoundParameters.ContainsKey("HttpPort") -and $existingConfig.httpPort) {
    $HttpPort = [int]$existingConfig.httpPort
  }
}
if (-not $NodePath) {
  $NodePath = (Get-Command node -ErrorAction Stop).Source
}
$node = [IO.Path]::GetFullPath($NodePath)
$tailscale = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node executable not found: $node"
}

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
$lc0Root = Join-Path $env:LOCALAPPDATA "ChessTrainer\engines\lc0-v0.32.1-fresh"
if (-not $Lc0Path) { $Lc0Path = Join-Path $lc0Root "lc0.exe" }
if (-not $Lc0Bt4Weights) { $Lc0Bt4Weights = Join-Path $lc0Root "BT4-it332.pb.gz" }
if (-not $Lc0T1Weights) { $Lc0T1Weights = Join-Path $lc0Root "T1-odds.pb.gz" }
if (-not $Lc0LqoWeights) { $Lc0LqoWeights = Join-Path $lc0Root "queen-odds\lqo_v2.pb.gz" }
foreach ($lc0File in @($Lc0Path, $Lc0Bt4Weights, $Lc0T1Weights, $Lc0LqoWeights)) {
  if (-not (Test-Path -LiteralPath $lc0File -PathType Leaf)) {
    throw "Required LCZero file not found: $lc0File"
  }
}
$tailscaleIp = @(& $tailscale ip -4 | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })[0]
if (-not $tailscaleIp) {
  throw "This PC does not have an active Tailscale IPv4 address."
}
$tailscaleDnsName = (& $tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd(".")
if (-not $tailscaleDnsName) {
  throw "This PC does not have an active Tailscale DNS name."
}
$privateOrigin = "https://$tailscaleDnsName"
if (-not $UciHost) {
  $UciHost = if ($existingConfig -and $existingConfig.uciHost) {
    [string]$existingConfig.uciHost
  } else {
    $tailscaleIp
  }
}
$existingAllowedOrigins = if ($existingConfig -and $existingConfig.allowedOrigins) {
  @($existingConfig.allowedOrigins)
} else {
  @()
}

New-Item -ItemType Directory -Force -Path $serverRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\stockfish-remote-server.mjs") -Destination $serverScript -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\lichess-local-eval-reader.mjs") -Destination $localEvalReader -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\lc0-network-routing.mjs") -Destination $lc0NetworkRouting -Force

$config = [ordered]@{
  enginePath = $EnginePath
  threads = $Threads
  hashMb = $HashMB
  uciHost = $UciHost
  uciPort = $UciPort
  httpHost = "127.0.0.1"
  httpPort = $HttpPort
  maxDepth = 999
  maxMultiPv = 8
  lc0Path = [IO.Path]::GetFullPath($Lc0Path)
  lc0Networks = [ordered]@{
    bt4 = [IO.Path]::GetFullPath($Lc0Bt4Weights)
    t1 = [IO.Path]::GetFullPath($Lc0T1Weights)
    lqo = [IO.Path]::GetFullPath($Lc0LqoWeights)
  }
  lc0Backend = "cuda-fp16"
  lc0Threads = 1
  lc0MinibatchSize = 8
  lc0NnCacheSize = 50000
  localEvalPath = (Join-Path $env:APPDATA "org.encroissant.app\lichess-cloud-evals")
  allowedOrigins = @(
    $existingAllowedOrigins
    "https://gaming-pc.tail89d19b.ts.net",
    $privateOrigin,
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost"
  ) | Select-Object -Unique
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding utf8

$taskName = "Stockfish18Remote"
$taskPath = "\EnCroissant\"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$serverScript`"" -WorkingDirectory $serverRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.Priority = 4
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Runs the private Stockfish 18 and LCZero phone-analysis backend."
Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $task -Force | Out-Null

Stop-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$serverScript*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$stopDeadline = (Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 200
  $serverProcess = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*$serverScript*"
  } | Select-Object -First 1
  $taskState = (Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath).State
} until ((-not $serverProcess -and $taskState -ne "Running") -or (Get-Date) -ge $stopDeadline)

if ($serverProcess -or $taskState -eq "Running") {
  throw "The previous Stockfish remote server instance did not stop cleanly."
}

Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath

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
  Lc0Available = $health.engines.lc0.available
  Lc0Networks = $health.engines.lc0.networks
  LocalHealth = "http://127.0.0.1:$HttpPort/v1/health"
  TailnetUci = "$($tailscaleDnsName):$UciPort"
  TailnetHttps = "https://$($tailscaleDnsName):$HttpsPort"
  ScheduledTask = "$taskPath$taskName"
} | Format-List
