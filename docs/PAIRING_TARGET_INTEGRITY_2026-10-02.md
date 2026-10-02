# Published tournament target integrity

The shared En Croissant desktop/phone forecast now rejects ambiguous published target assignments. A self-pairing, duplicate row, multiple opponents, duplicate involved roster identity, or an opponent assigned to another target board returns unavailable with the existing conflict presentation. It no longer confirms whichever conflicting row happens to appear first. An opponent outside the roster retains the existing unmatched-roster refusal.

Unique named assignments remain confirmed regardless of their pending result. Unique solo assignments retain the distinct zero/half/full/unknown award copy. Published assignments retain precedence over inactive/absence/unsupported-format hints. Unrelated roster duplicates and conflicts in other rounds do not change a valid published target. This narrow source guard does not alter phase/final-round policy, ranking, probability calibration, native parsing, standings or the separate evidence resolver.

## Scope and verification

The Novelty guard and removal of the old first-row lookup helper were ported into the existing En feature checkout and primary. Before editing, both forecast files had SHA-256 `0cc5b2adc2b313131257d80f13a842f1136eded107505866e56574ba285a2462`; both now have `d6def63d27ecca3b99bd08248cc4018794792a4e2c34adfbac9a3d0a78c46468`. Exact pre-edit guards preserved primary's unrelated work and native architecture. Shared desktop and phone use this same implementation.

Each checkout passes **10 direct pure groups, 101 assertions and 34 synthetic states**, including row-order reversal, the affected opponent's perspective, identical duplicate rows, duplicate roster identities, solo/named conflicts, source-priority and unaffected controls. Input byte hashes are retained for every state; no input mutation occurred. Running these regression bodies against the previous feature HEAD in memory fails on the self-opponent case as expected.

| Checkout | Internal elapsed time | Receipt SHA-256 |
| --- | ---: | --- |
| Feature | 2.1551 ms | `ea6633ccc77f77cddc870c97d415ae42b456e184f230a2f7ebc3291ba82ce059` |
| Primary | 2.1778 ms | `8da65b6e28553d277102a23b0f8004e06ff899ad35f6e8d8d152d6d959e4d497` |

External receipts: `C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/target-integrity/en-feature-v2.json` and `en-primary-v1.json`. They contain actual forecasts, source/input/harness hashes and verification scope. The earlier feature-v1 receipt and original TS harness are preserved there; v2 uses a JavaScript harness compatible with the existing Vitest test import and the declared `other` format control. No model inputs or forecast evidence were overwritten.

`scripts/check-published-target-integrity.mjs` contains the same assertion bodies called by `src/features/tournaments/tests/publishedTargetIntegrity.test.ts`. Harness SHA-256: `9d47ecc75ff59989f02fcc0e3651632f965ce958d55fb9a8a107aaf6a3fdfe4a`. Direct execution reuses the existing extensionless-source loader, SHA-256 `b8b1ac4e0ad7ba46d52292c72cff325e62c7ace711286d43caabac040c4b8dbc`; it does not bundle or import solver/worker implementations. From either En checkout:

```powershell
node --import file:///C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/en-prior-result-source-loader.mjs scripts/check-published-target-integrity.mjs
```

An optional `--output NEW_RECEIPT_PATH` saves a new receipt and refuses to replace an existing file. The test bodies were run directly, not through Vitest. Full project types, broader frontend/native suites, rendered desktop/phone UI and installed delivery remain unverified for this slice. These structural regressions establish no accuracy or calibration gain. No exact/sampled worker, public corpus, native build, runtime, service, database, hostname or deployment was touched.
