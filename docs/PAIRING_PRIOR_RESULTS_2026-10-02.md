# Unavailable historical tournament results

The shared En Croissant desktop/phone forecast now withholds numeric pairing chances when an earlier named result is unreadable outside the immediate unfinished live round, or a prior solo assignment has no reported score. Candidate order, colour and prior-opponent exclusions remain available. The canonical helper also declines exact/sampled/history reconstruction and avoids starting the worker; a stale exact response cannot restore percentages. Published pairings/byes, completed standings, opening abstention and RR behavior retain precedence.

Locally derived standings preserve the existing `scoreKnown` representation: any unreadable listed result is unknown, and no invented rank is presented when a reconstructed score is unknown. Source-published standings keep their reported points/ranks. Existing Tracker table, Your points and player-detail guards consume this; the adjacent Points/Order help explains the dash. Home/phone Prep rows share null-probability help. No native schema, result tokens, fit, attendance model, runtime or deployment changed. Missing native score provenance and unflagged missing-row coverage remain separate limitations.

The change is mirrored narrowly into primary, preserving its existing plural game-count copy and unrelated dirty work. Source modules and tests match between checkouts apart from that existing Tracker wording.

## Verification boundary

Each En checkout passed **337 assertions over 26 synthetic input-hash-matched states**, separately paired with current Novelty integration. Both complete paired checks passed 674 assertions:

| Target | Paired internal time | Process time | Retained receipt SHA-256 |
|---|---:|---:|---|
| En feature | 151.1023 ms | 0.3746684 s | `b466415289a751bdac220816fcbbaa0a855fab6755c05fd189215b6887a95980` |
| En primary | 85.4422 ms | 0.2755551 s | `c2da5d56ccc273334a63cf487c071fc65904008d50a07e188cf041bf03cf35c9` |

Receipts are retained under `C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/` as `en-feature-prior-result-candidate-v1.json` and `en-primary-prior-result-candidate-v1.json`. They include source hashes, all state results and the original baseline hash. The shared helper's En source hash is `7f3070099e154bdaa2317d7ed7546b565b567506cf940985fced81618c3819ac`.

These checks call actual fallback/scoring functions. Exact, sampled and history functions are called only on guaranteed early-refusal inputs; no pairing solver or worker runs. The source loader handles only En's extensionless TypeScript/JSON imports and does not bundle, rewrite or execute native code. Loader SHA-256: `b8b1ac4e0ad7ba46d52292c72cff325e62c7ace711286d43caabac040c4b8dbc`.

From the Novelty integration checkout, reproduce with a **new** receipt destination:

```powershell
node --import file:///C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/en-prior-result-source-loader.mjs scripts/pairing-20261002-prior-result-candidate.mts --baseline C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/prior-result-stress-v2.json --mirror C:/Users/Lox/Desktop/repo/.worktrees/en-tournament-parity-20260927 --out C:/Users/Lox/Documents/Novelty/PairingResearch/2026-10-02/next-diagnostics/en-prior-result-new.json
```

Use the En primary path for its mirror check. Output creation refuses an existing destination.

Five new focused regression groups and the revised solo/help expectations are present. **Vitest, project TypeScript and responsive browser execution for this newer patch remain pending the coordinated timed-baseline slot.** Earlier strict-result/native/browser/replay receipts predate this policy change. These synthetic assertions do not establish improved empirical calibration or deployed desktop/phone behavior. No owner data, service, hostname, installed app or live phone site was touched.
