param([Parameter(Mandatory = $true)][string]$EnginePath)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $EnginePath -PathType Leaf)) {
  throw 'Provide the path of an existing external Stockfish executable.'
}
$previousEngine = $env:EN_CROISSANT_STOCKFISH_ACCEPTANCE_ENGINE
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  $env:EN_CROISSANT_STOCKFISH_ACCEPTANCE_ENGINE = (Resolve-Path -LiteralPath $EnginePath).Path
  # This explicit filter does not run the deterministic peer or owner data.
  & cargo.exe test --manifest-path src-tauri/Cargo.toml --bin en-croissant-fork -j 4 whole_game_low_completes -- --ignored --nocapture
  if ($LASTEXITCODE -ne 0) { throw 'Real Stockfish whole-game acceptance failed.' }
} finally {
  $env:EN_CROISSANT_STOCKFISH_ACCEPTANCE_ENGINE = $previousEngine
  Pop-Location
}
