$ErrorActionPreference = 'Stop'

$repairRoot = 'C:\ProgramData\CodexDisplayRepair'
New-Item -ItemType Directory -Force -Path $repairRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

reg.exe export 'HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' (Join-Path $repairRoot "GraphicsDrivers-before-hags-disable-$stamp.reg") /y | Out-Null

$latestDump = Get-ChildItem 'C:\Windows\Minidump' -Filter '*.dmp' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($latestDump) {
    Copy-Item -LiteralPath $latestDump.FullName -Destination (Join-Path $repairRoot $latestDump.Name) -Force
}

$graphicsDrivers = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers'
Set-ItemProperty -LiteralPath $graphicsDrivers -Name HwSchMode -Type DWord -Value 1

sc.exe config SunshineService start= delayed-auto | Out-Null

$result = [ordered]@{
    AppliedAt = (Get-Date).ToString('o')
    HwSchMode = (Get-ItemPropertyValue -LiteralPath $graphicsDrivers -Name HwSchMode)
    Hags = 'Disabled after reboot'
    SunshineStart = (Get-CimInstance Win32_Service -Filter "Name='SunshineService'").StartMode
    CrashDumpBackup = if ($latestDump) { Join-Path $repairRoot $latestDump.Name } else { $null }
    ScalingTarget = '175%'
    ResolutionTarget = '3440x1440'
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repairRoot 'gpu-crash-fix-result.json') -Encoding UTF8

shutdown.exe /r /t 15 /c "Applying NVIDIA/Sunshine crash-stability fix (HAGS disabled)"
