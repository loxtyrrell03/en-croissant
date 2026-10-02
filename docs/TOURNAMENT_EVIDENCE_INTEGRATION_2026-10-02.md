# Forecast evidence integration

This frontend source milestone connects the previously isolated evidence resolver to numerical admission and presentation. It is a correctness/knownness repair, not a newly validated probability model or an empirical accuracy improvement. Existing probability weights and the running frozen replay-v2 experiment are unchanged.

## Behavior

- Complete recorded history can recover legacy totals. Missing assignments, old unknown results, unknown scores, conflicting next-round status, and unverified legacy absence hints withhold candidate and Other percentages. Ordinary pending named games in the immediately preceding live round remain eligible uncertainty.
- Published scoped totals remain authoritative, including fractional adjustments. The installed Swiss engine reconstructs scores from games and byes, so adjusted totals that it cannot represent decline exact/sample admission; no fictional rounds or awards are added. Conditional score projection preserves the original score basis without rounding it to half-points.
- A solo pairing row and a compatible explicit status-page award are reconciled once. The same award reaches result completeness, live score projection and exact-engine history. Unknown awards remain unknown.
- Published target assignments retain priority when their involved identities/assignments are unique. Explicit statuses control version-one availability; older compatibility flags alone cannot confirm withdrawal or a bye. Round-robin inference retains its distinct assumed-schedule status.
- Standings keep every roster member, distinguish unknown totals from zero, and retain individually published exact-round ranks. Derived ordering requires known scores for everyone. Absence estimation requires explicit zero-point no-game evidence. Backcasts remove future totals, statuses and coverage before reconstruction.
- Every admission path resolves original evidence before private participation assumptions. Client cache identity includes evidence changes and excludes only observation timestamps. Copied/serialized prepared views retain refusal evidence; cleaning invalid provenance cannot make them eligible on reload.

The resolver cache bounds allocation to 250,000 player/round records. This is a resource guard, not a new model field-size limit or a complete untrusted-snapshot schema validator. Full malformed input validation remains separate.

## Verification boundaries

The actual-source admission harness executes the real forecast, exact/sample entry points, client, hook admission and worker handler while replacing engine calls/Worker/React runtime explicitly. Novelty integration, Novelty primary, En feature and En primary each pass **22 groups / 725 assertions**. Positive controls reach doubles; rejection controls prove no new engine/worker calls. There are zero real solvers or workers in these runs.

The direct standings/absence/backcast consumer harness passes **11 groups / 89 assertions** in each of those four checkouts. The primary mirrors preserve unrelated source and established product-specific copy, using pre-write hashes and readback. Native producer files are excluded from that mirror.

Review retained failures before repair: solo/status coalescence, live half-award projection, conflicting target status, hook/RR compatibility flags, copied-view refusal laundering, and fractional score rounding. Harness-only mistakes and startup failures are also retained rather than overwritten. Accuracy or calibration gains must not be inferred from assertion counts.

External receipts live under `C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/`:

| Check | Receipt | SHA-256 |
| --- | --- | --- |
| Novelty admission | `evidence-admission/synthetic-run-10.json` | `6cfcfae29c29acc7b58d0800d2bdc284dcb82c2ca0b5d856548b066b324a8719` |
| En feature admission | `evidence-admission/en-synthetic-run-3.json` | `20f6c03746a9f3ea84a43348c02e88a4ee149d7632fd55948a340c4080a12fb1` |
| Novelty primary admission | `evidence-admission/novelty-primary-final-1.json` | `4c1dfd1fd2f9136aba26a14bb562c93a834546f23bf2a37a232c6fcdffc4339c` |
| En primary admission | `evidence-admission/en-primary-final-1.json` | `642693fa6dc62ed1eec6aeda8645767fd54c6cd2a46eb37c719449025d8ef759` |
| Primary guarded writes | `primary-mirror-preflight/20261002T192611943269Z-applied-2b94f5a0/applied.json` | `71f10086684d8283edb246230eac1ca46fc18a98d7a164ae002723540c909bac` |

The [verification index](TOURNAMENT_EVIDENCE_INTEGRATION_2026-10-02.json) binds all 23 retained checks/mirror/preparation receipts, including the 34 client/sampling fixture assertions per feature checkout and independent serialization review. Each test receipt binds its actual loaded source and transpiler before/after execution. The admission harness SHA-256 is `a9f750d7075546e1a27f69ea116c5082a71739b20905f7861daabf22e492e219`. En reuses the existing dependency root explicitly; no dependencies were installed/copied.

## Remaining work

Existing test fixtures now distinguish valid positive controls from unaccounted historical rows and permissive legacy status flags. The prior-result actual-file adapter passes six groups / 142 assertions in each feature checkout. Pure forecast/opening test bodies pass 39 cases / 556 assertions in Novelty and 44 cases / 1,095 assertions in En, with seven solver-dependent cases explicitly skipped in each; engine entry is forbidden in that adapter. These are not full Vitest runs. Real-engine numerical expectations are not replaced with new goldens. Full Vitest/project type checking, native compilation/tests, rendered interactions and installed desktop/phone delivery remain pending the coordinated benchmark slot; pure adapters do not substitute for those checks.

The native producer candidate is separately prepared in both owned feature checkouts: declared score columns, f64 score precision, source-round heading checks, strict status evidence and complete-roster coverage. Eleven native fixture groups and read-only syntax checks exist, but compilation/execution is unverified. Keep that preparation separate until its native checks pass. Opaque internal native HTTP fetches still lack the required complete acquisition trace. New fresh-event outcomes must wait for traced/offline acquisition and an immutable generator/scorer/source/runtime freeze.

No customer release, service restart or physical-device check was performed. Primary source mirrors and shared En desktop/phone modules are source parity, not delivery proof. The four-event large-field replay remains the earlier frozen control, including retained timeouts; it is not this newer candidate.
