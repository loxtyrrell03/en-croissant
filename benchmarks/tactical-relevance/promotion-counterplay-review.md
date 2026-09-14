# Promotion combinations and pawn-race counterplay — adapter 97 / live 102

## Scope

This is a diagnostic follow-up to the public real-game puzzle **MJZcU**, not a new representative accuracy sample. It tests 116 fixed nearby perturbations (added enemy pieces and relocated attacking king), then audits changed decisions with Stockfish. Earlier output-blind opening, positional, endgame and rare-theme sets are replayed separately. Unchanged outputs are not certified correct; rejected proofs are not automatically correct negatives.

The [public receipt](promotion-counterplay-engine.json) contains **70 final fresh depth-16 Stockfish 18 searches**: the real root, changed perturbation roots and unrestricted choices, all 21 selected first-defence answers, twenty hash-selected promotion leaves, and concrete counterpromotion/skewer controls. Scores are side-to-move full-position estimates in centipawns, distinct from the classifier's local material units (pawn = 100). These are searches, not 70 independent puzzles. The exporter validates exact known inputs and every complete legal PV, checks all root replies and all 14,572 recorded decision occurrences, and publishes only public fields. The full proof has 3,524 distinct position/move decisions; the twenty engine-searched promotion leaves are a sample, not every leaf.

## The real lesson and the false claims

In MJZcU, **Rxe4** removes the knight controlling d2 so the connected c3/d4 passers can advance. The primary remains **Promotion Combination**, including root-only input and missed-opportunity review. The five-ply source line ends in c1=Q; the fresh engine line promotes on ply 11. Promotion stays on its actual ply, not as another first-move theme.

The final independent proof covers all **21 legal root replies**, with a minimum local material bound of **220**. The fresh root search evaluates Rxe4 at **+248 cp** for Black. Every selected first-defence answer is positive in the separate engine audit (minimum **+265 cp**); the twenty sampled promotion leaves are strongly positive or mating. This supports these selected witnesses, not a general proof that local material equals a won full position.

The audit exposed concrete false promotion claims:

| Relocated black king | Rxe4, full-position estimate | Better root choice | Claim encountered |
| --- | ---: | --- | --- |
| d1 | −703 cp | c2, −20 cp | Adapter 96 admitted a local 120-unit promotion proof. |
| f2 | −647 cp | Ke3, −53 cp | Adapter 96 admitted a local 120-unit promotion proof. |
| a4 | −708 cp | c2, −40 cp | Adapter 96 admitted a local 120-unit promotion proof. |
| e2 | −198 cp | c2, +393 cp | An intermediate adapter-97 candidate introduced this claim; adapter 96 did not admit it. |

All four now abstain from Promotion Combination with root-only and legal historical continuations, including the production worker. The d1/f2/a4 positions are losing sacrifices instead of the advertised promotion tactic. At e2, Rxe4 throws away a winning alternative. These judgements use the actual defensive resources and separate root searches, not merely negative scores.

The explicit a4 continuation is **Rxe4 fxe4 c2 Rxd4+ Kb5 a4+ Kc5 Rd8 c1=Q Rc8+**. An intermediate proof selected this route. Every legal black evasion now loses Qc1 to Rxc1: queening has not settled the race. The e2 counterexample trades the new queen, recaptures with the king and eventually lets both sides promote; subtracting queen values disguises unresolved counterplay.

## General changes

- A material balance cannot settle a transition where the attacker has only king and pawns. Every defensive reply needs an actual immediate promotion witness, or the bounded main search must continue. That extra promotion cannot inflate the previous material bound.
- Checking replies and penultimate-rank pawn advances require an actual legal answer preserving the bound. Giving another check is not by itself an answer to the race. A profitable counterpromotion fails this local certificate rather than being treated as arithmetic compensation.
- Capturing the attacker's last non-pawn piece, including a promoted queen, cannot be funded by a hypothetical king recapture without checking the resulting pawn race. The shallow counterplay layer fails closed on another such transition.
- Capture-first settlement prefers taking a genuinely offered piece over an arbitrary quiet retreat. After the real root's **Rxd4**, an earlier selected **Re1** could draw; the final witness is the immediate **Rxd4**, which the fresh search evaluates at +889 cp.
- Normalized position caches, depth-aware reuse and colour-stable king ordering avoid repeating equivalent work. The promotion-only operation allowance increases from **131,072 to 262,144**; the complete real proof uses **207,931**. The existing **3-second classification** and **20-second startup** deadlines do not increase. No other proof family gets the larger allowance.
- Accepting an independently proved promotion sacrifice no longer adds a generic **Winning Recapture** badge. Its SAN move remains, and distinct mechanisms remain eligible. This also applies to truncated input. The fresh fifteen-ply engine PV, source/live classification, rendered explanation and built worker retain the primary lesson and the actual later promotion without that misleading secondary gain.

Diagnostics bypass the ordinary root cache and can return selected legal decisions and root branch bounds. They are absent from normal classifier results. Move counters below the fifty-move threshold are normalized only in this capture-reset, bounded search; this does not implement general repetition-history or exact multi-pawn endgame solving.

## Contrary results retained

The 116 perturbations go from twelve admitted local certificates to six. That is **not an accuracy gain of six**. Five withdrawn king variants (b1, f1, b2, a3, b5) still have winning Rxe4 searches, approximately +229 to +429 cp: these remain coverage misses. The bishop-on-h8 variant is a losing whole position, but Rxe4 is also the engine's best move; withholding its certificate is not counted as proving a tactical mistake.

Three newly admitted variants are winning in the finite engine searches. With Ke3, c2 evaluates better than Rxe4. With Kc7/Ke7, simply **Kxd8** wins the rook and evaluates better than the classified sacrifice. A valid motif for a candidate is not automatically the best move or most useful primary lesson across candidates. The live engine-choice and relevance layer remains important.

Earlier lower-budget and partial-counterplay candidates, an unsuccessful transition-cache experiment, the drawing Re1 witness, the checking skewer and the introduced e2 false claim are retained privately. An intermediate 120-unit bound for the real example was superseded by the final stronger 220-unit witness selection. A one-million-operation diagnostic established the required visit count; production uses 262,144, not that diagnostic allowance.

## Verification and delivery

- **1,785 selected source/review/render tests** pass across 118 files (117 passing, one conditionally skipped), with 84 conditional test skips. Engine/export runs are separate. Existing missed, causal-comparison, reflected-colour, budget and continuation-boundary checks pass.
- **892 actual-controller production-worker inputs** pass across fifteen tests: the existing 891-input run plus the fresh engine-PV acceptance regression. The [386-input public timing receipt](built-worker-adapter97.json) measures median/p95/max **74/243/869 ms**, excluding engine search and native UI; maximum startup is 39 ms and classification/transfer 839 ms. The common 376 inputs measure 72/196/641 ms, with unchanged headline lists. No speedup claim. The real root-only/full-source inputs take 525/647 ms total.
- All **246 exact private course/generated-game full results**, **twenty prior rare full results**, **23 cross-phase full results** and **32 frozen primary-priority judgements** remain unchanged. The new acceptance regression uses a different fresh engine continuation. Stability is not an accuracy score.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, eleven-file lint, three built-service tests and two dev-cache/recovery scenarios pass. Final artifact: `liveTactics.worker-CeYl24Pu.js`.
- **Twenty-two isolated cold HTTP cases** pass. Final first/next startup is 1,431/64 ms; the real promotion case is 1,879 ms startup plus 977 ms classification/transfer, and the counterpromotion control is 370/1,303 ms. An earlier passing run this session took 10,223 ms for first startup and 8,286 ms for the real promotion startup. That variability remains unresolved; neither run proves native WebView latency.

Authoritative private receipts: `adapter97-counterqueen-final-trace.json`, `adapter97-counterqueen-final-counterplay.json`, `adapter97-public-final-engine.json`, `adapter97-release-exact-replay.json`, `rare-theme-adapter97-release.json`, `cross-phase-adapter97-release.json`, `adapter97-release-worker.json` and `adapter97-release-cold-http-worker.json`. The older baseline is `adapter97-promotion-counterplay-kings.json` (generated with adapter 96); intermediate receipts are not final verification.

No owner app/package/service restart, installation or deployment occurred. Paid material stays private. This milestone does not finish broader positional, quiet-move, rare-theme, primary-choice, repetition or larger-ending coverage, and does not guarantee a correct primary theme in every position.
