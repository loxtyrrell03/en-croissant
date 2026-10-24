# Tournament round metadata parity

The shared En desktop/phone forecast rejects invalid explicit target rounds before field preparation. Zero, negative, fractional, nonfinite, unsafe and beyond-total targets return unavailable rather than a completion claim. `nextRound:null` retains its separate meaning. A positive total bounds the target; zero total means unknown. Direct historical backcasts remain independent of the snapshot's current next round.

Normalization also repairs a stale complete phase when pending named games in a valid later published round contradict it. A valid explicit published target retains confirmation priority; otherwise recognized current results or a consistent live marker preserve the live round. Completed-round authority at a positive total remains intact. The earlier unsupported-true-result demotion behavior remains compatible, and malformed explicit targets cannot be silently converted into a terminal null.

The same admission helper is used by the forecast, hook/client, exact/sample functions, history reliability and whole-field worker handler. Preparation colour uses the normalized valid target and preserves En's unselected-player guard and native preparation architecture. Ranking/calibration, native parsing, saved-record formats and the isolated evidence resolver are unchanged.

## Guarded port and pure checks

Nine existing product files were verified byte-identical between feature and primary before applying minimal edits; the new `tournamentRoundMetadata.ts` was absent. Pre-edit hashes remain in `C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/en-round-metadata/pre-port-v1.json`. All ten final product files match between En checkouts; primary's unrelated dirty work is preserved.

Each En checkout passes **eight pure groups / 2,298 assertions**. The retained 87 snapshots / 391 player states show exactly twelve metadata corrections beyond the prior seven assignment-integrity fixes: four stale completion labels and eight invalid targets. The remaining 379 forecasts preserve their fields after explicitly mapping established En wording. The opening-help branding and two existing RR caveat strings (19 states) are compared using exact reviewed string pairs; arbitrary text differences fail. The old wording is present in the pre-port feature commit and was not changed by this milestone.

Tests use the actual source modules with injected dependencies, poisoned field getters, a fake client Worker and the actual whole-field message handler. Invalid targets reach no roster allocation or sampled call; valid admission controls prove the stubs are reachable. The actual Prep callback is extracted through the TypeScript parser and includes a null selected-player control. Every original input hash is checked. All 87 normalized snapshots remain equal after serialization and re-normalization, avoiding reliance solely on WeakMap caching.

| Checkout | Internal time | Final receipt SHA-256 |
| --- | ---: | --- |
| Feature | 142.3084 ms | `3f54d4db749e071a48b9da78e6a8a5ecdabb7d22e9f8b721d65a3dbb5e5063c9` |
| Primary | 140.6144 ms | `e6cd62d438c815259d45dfb504fd53cf800dc318365035642f2a4a58a5f026e5` |

The external receipts are `en-round-metadata/feature-attempt-4.json` and `primary-attempt-2.json` beneath the research directory above. They retain source, original-input, prior-fix, fixture and TypeScript-runtime hashes, changed forecasts, exact native copy differences and mock-call counts. Source/runtime/input hashes remain unchanged during each run. Earlier receipts and harness versions remain; feature attempt 1 correctly stopped on the unregistered opening-help branding difference, which was then verified against unchanged pre-port source. Final diff review preserved the native null-selection guard and added its direct regression before the final passes.

The harness is `scripts/check-tournament-round-metadata.mts`, SHA-256 `4979c5b1a2f514329e21467a35950721ab9c6b972d2131768a3a63414773c99e`. It reuses the existing source loader and installed Novelty TypeScript package without copying dependencies. From either En checkout, use a new receipt path:

```powershell
node --import file:///C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/en-prior-result-source-loader.mjs scripts/check-tournament-round-metadata.mts --baseline C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/structural-stress/run-v1 --out NEW_ABSOLUTE_RECEIPT.json --novelty C:/Users/Lox/Desktop/repo/outpost-chess-tournament-integration
```

Unknown-total huge safe integers remain a documented limitation: the predicate admits them without inventing a tournament ceiling; tests never send those values into allocation or workers. This is not complete untrusted-snapshot resource validation. Full project types, Vitest, native, actual solver/worker, rendered UI and installed desktop/phone delivery remain pending. No service, hostname, database, runtime or deployment changed. The synthetic results establish no empirical accuracy, calibration or application-latency improvement.
