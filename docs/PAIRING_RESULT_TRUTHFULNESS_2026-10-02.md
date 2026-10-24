# Strict published tournament results — 2 October 2026

The shared desktop/phone predictor now treats a game result as known only when both seats are named, its published flag is true and its entire result token is recognized. A value such as `*`, `adjourned`, `1-unknown` or `garbage.5` cannot become a win, draw, resolved-game count or proof that the event has finished. Explicit ordinary scores, all supported official forfeits, decimal/comma/Unicode draws and occupied-seat solo awards remain supported. An explicit solo zero stays known even in older snapshots whose flag is false.

A common decoder feeds forecasting, exact reconstruction, sampled outcomes, history reliability, standings/performance and result presentation. Unknown named assignments still preserve colours and prior opponents; only recognized forfeits are unplayed. Sampling ignores equivalent unreadable named-result placeholders when deriving its seed. The immutable legacy adapter only demotes unsupported true flags and corrects phase/next-round metadata derived from those current flags; it never reveals false-flag results or overrides completed standings. Tracker and Prep colour lookup use the same corrected snapshot.

A complete forecast may mean there is no later pairing to predict while the final round is still in progress. En's heading now preserves that distinction through the existing summary. Result cells show Scheduled or Awaiting result for unreadable named rows; preceding-round coverage counts only recognized results. Existing first-round/incomplete-history Unknown probabilities, published assignments, source-specific standings uncertainty and preparation actions remain intact.

## Verification and boundaries

- Clean feature: 112 focused tests in 11 files passed, followed by all eight sampled tests after the new seed regression (113 distinct forecast/presentation tests), then three Prep/handoff tests. Full project TypeScript passed after the final source edits.
- Primary: the 113-test/11-file forecast/presentation suite and full project TypeScript passed. The final three-line Prep colour normalization delta is byte-identical to the feature source tested afterward; its focused test/type run was not repeated in primary while the parent began a timed research run.
- Native: 28 real parser/phase/child-module tests pass separately for feature and primary in the existing offline harness. No full En/Tauri build was made. The original collector SHA-256 before and after both runs remains `ada05a59096d5067d4e8ba3eada7f0bae2b8c89b9cae36ebcb013d212ded3a00`. Cargo reordered one harness lockfile's root package; package blocks were verified unchanged and that incidental ordering was restored.
- Actual shared Tracker: 20 headless WebKit checks cover live final round, before-play published pairing, completed standings, mid-round counts and hidden false-flag results at 1280/760/390/360 px, touch enabled at narrow sizes. Results navigation, headings, strict cell labels and overflow checks pass with no page errors or external requests. Initial harness iterations corrected the tab role and an internally contradictory synthetic phase, without changing product behavior to accommodate them.
- Cross-product: all 11,403 fallback player states/316 snapshots/four exposed events match current Novelty using its corrected immutable replay-v2 builder. IDs/order/chances/colours/kind/round/confidence/Other/display labels match; caveat/branding copy is outside the comparison. Ten source kernels, six frozen weight files and the installed Swiss dependency trees agree. This parity check runs no exact workers and makes no new accuracy or calibration claim.

The accompanying `PAIRING_RESULT_TRUTHFULNESS_20261002.json` retains source hashes and compact browser/parity receipts. The initial four-event probability receipt remains historical: it used v1, which later proved to miss official `+--`/`--+` award scores. This milestone uses v2 and does not silently rewrite those earlier results.

## Reproduce

Use the existing installed tooling, with no downloads:

```powershell
node node_modules/vitest/vitest.mjs run src/features/tournaments/tests/publishedPairingResult.test.ts src/features/tournaments/tests/completedForecastHeading.test.tsx src/features/tournaments/tests/forecastPresentation.test.tsx src/features/tournaments/tests/pairingForecast.test.ts src/features/tournaments/tests/sampledSwissForecast.test.ts src/features/tournaments/tests/publishedNoOpponentScore.test.ts src/features/tournaments/tests/pairingHistoryCalibration.test.ts src/features/tournaments/tests/tournamentInsights.test.ts src/features/tournaments/tests/tournamentAwardedScores.test.ts src/features/tournaments/tests/firstRoundProbability.test.ts src/features/tournaments/tests/probabilityAbstentionPresentation.test.tsx --maxWorkers 2
node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit
node scripts/qa-pairing-results.mjs --tools-root C:/Users/Lox/Desktop/repo/outpost-chess
node scripts/check-pairing-results-parity.mjs --novelty C:/Users/Lox/Desktop/repo/outpost-chess-tournament-integration --tools-root C:/Users/Lox/Desktop/repo/outpost-chess
```

The native harness uses `PAIRING_NATIVE_SOURCE` set to the exact `src-tauri/tournament-core/src/tournament.rs` path and `CARGO_TARGET_DIR` set to the existing `outpost-chess-tournament-benchmark/scripts/tournament-native-check/target`, then `cargo test --locked --manifest-path C:/Users/Lox/Desktop/repo/outpost-chess-tournament-integration/scripts/pairing-20260912-fixed-board-native/Cargo.toml -- --test-threads=1`. Coordinate sequential target ownership and preserve the original collector hash.

Changes were made in the reused feature checkout and mirrored into primary after pre-copy byte guards. The primary Tracker's different game-count wording and unrelated dirty source/root guidance were preserved. Small ignored QA bundles/screenshots remain under `tmp/pairing-result-qa` and `tmp/pairing-results-parity`; no dataset copies were made. No installed desktop/phone deployment, runtime restart, profile mutation, hosting change or physical-device verification occurred.

## Reviewed token narrowing

- Review correction after the broad verification above: unsupported `1w-0l` / `0l-1w` tokens remain unknown in both native and frontend decoders. There is no verified official meaning establishing either a played result or a forfeit; never use them to discard prior-opponent/colour history. Two tiny token regressions passed separately in both checkouts after this narrowing (all known ordinary/sign/forfeit forms still recognized). The earlier 113-test, native, browser and corpus parity receipts predate this correction; no broad/native/build rerun was performed during the coordinated large-field benchmark.
