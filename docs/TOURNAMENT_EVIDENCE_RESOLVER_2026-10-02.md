# Isolated tournament evidence resolver

This is source preparation only. The native parser, existing bridge, forecasts, exact/sampled workers, standings views, saved snapshots and phone APIs are **not connected to this module**. Existing app behavior and source limitations remain unchanged. No runtime or delivery work was performed.

`tournamentSnapshotEvidence.ts` resolves separate evidence for aggregate points, prior assignments/results and the published target. Its additive types require `evidenceVersion === 1` before trusting claimed score/status/coverage metadata. Legacy scores require complete recognized history; old absence/half-bye projections remain unverified hints. Missing rows and unknown awards never become zero. Explicit no-game or late-entry status preserves its separate optional award.

The latest usable published total retains authority, including negative organiser adjustments, and advances only through recognized later awards. A later derived total cannot erase the adjustment, conceal conflicting published totals, or supply missing results. Malformed in-scope score metadata/standings fail closed; truly future evidence is excluded before content validation. A historical table cannot hide a scope mismatch through a future-dated row. Aggregate knownness does not establish individual results or complete assignment coverage: future consumers must combine the evidence they require.

The target is resolved independently from earlier history. Duplicate/self/outside-roster assignments remain conflicts; unresolved named games retain opponent/colour and explicit forfeits retain their separate meaning. Immediate unfinished live results are distinguished from missing earlier results. This module changes neither attendance nor probability calibration.

## Port and verification

The Novelty implementation and direct synthetic harness were carried into the existing En feature checkout and primary. Only module-import suffixes and the native frontend type path `@/features/tournaments/platform` differ. The harness is byte-identical. All destination files were absent before creation; primary's existing source and dirty work were preserved. No existing consumer, native file or bridge was edited.

| File | En SHA-256 |
| --- | --- |
| `tournamentSnapshotEvidence.ts` | `acf76706724fd32daaf74b5ef73f5aa9fa4ab3e2ad0994cb8fa45ce13558f788` |
| `tournamentSnapshotEvidenceTypes.ts` | `098b0d7c73fb14ede72a62cf926b08f550168419e9411c41513c7cbdb5e2f7d1` |
| `scripts/check-tournament-snapshot-evidence.mts` | `35df3c0b014fa559314d59be56758ce3cefb2e1b6edd37b754f2bd8110b9763c` |

Original Novelty module/type hashes are `b0f758470264cfc51e6975cf29ff804f26c55b271159f4ae85bb89a9a0e641fa` and `ef57aff2c526b945a9381feccd7f55306d69b4283af43a8d8f0510f2834db83d`. Guarded import-only transformation was checked against those frozen bytes, and each En file matches between checkouts.

Each checkout passes **26 pure groups / 293 assertions**. The harness exercises recognized and unknown results, source/derived conflicts and adjustments, malformed metadata, missing/duplicate/orphan assignments, explicit entry/no-game status, both-seat solo awards, prior/live/target separation, future-poison controls and input preservation.

| Checkout | Internal time | Process time | Receipt SHA-256 |
| --- | ---: | ---: | --- |
| Feature | 8.9060 ms | 98.5032 ms | `2e02ad6318253a74d2d4dc79ed45e40785d85746dcae308cd006e8a1d9d76e03` |
| Primary | 8.3998 ms | 94.1300 ms | `7e8aeb7778a66790a8af215b27b7cc1998a4f10075890b48858d6a518484a4c4` |

Receipts under `C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/evidence-resolver/` are `en-feature-v1.json` and `en-primary-v1.json`; they retain source/decoder/loader hashes and the complete tiny-harness output. From either En checkout:

```powershell
node --import file:///C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/en-prior-result-source-loader.mjs scripts/check-tournament-snapshot-evidence.mts
```

The existing source loader only handles En's extensionless TypeScript/JSON imports; its SHA-256 is `b8b1ac4e0ad7ba46d52292c72cff325e62c7ace711286d43caabac040c4b8dbc`. No model worker, solver, bundler, corpus, native build, network or UI was invoked. Full project types, consumer integration, broader tests, desktop/phone rendering and installed delivery remain pending. These synthetic checks establish no empirical accuracy or calibration improvement. Future wiring must preserve the same semantics across Novelty, En desktop and the hosted phone companion.
