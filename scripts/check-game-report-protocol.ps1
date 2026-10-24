param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $repoRoot 'tmp\game-report-protocol'
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$fixture = Join-Path $outputRoot 'fake-report-engine.exe'
$previousFixture = $env:EN_CROISSANT_REPORT_TEST_ENGINE
Push-Location $repoRoot
try {
  & rustc.exe --edition 2021 (Join-Path $PSScriptRoot 'fixtures\fake-report-engine.rs') -o $fixture
  if ($LASTEXITCODE -ne 0) { throw 'Report protocol fixture compilation failed.' }
  $env:EN_CROISSANT_REPORT_TEST_ENGINE = $fixture
  & cargo.exe test --manifest-path src-tauri/Cargo.toml --bin en-croissant-fork -j 4 report_ -- --include-ignored --test-threads=2
  if ($LASTEXITCODE -ne 0) { throw 'Game report protocol acceptance failed.' }
} finally {
  $env:EN_CROISSANT_REPORT_TEST_ENGINE = $previousFixture
  Pop-Location
  # Exact task-owned generated files only; keep the source and compact logs.
  foreach ($path in @($fixture, [IO.Path]::ChangeExtension($fixture, '.pdb'))) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
}
