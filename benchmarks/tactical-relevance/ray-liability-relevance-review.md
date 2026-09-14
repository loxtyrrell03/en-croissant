# Ray liabilities and primary-theme relevance

## Adapter 89 / live pipeline 94

This milestone tightens pin/skewer proof and same-move theme selection. It is not an accuracy percentage or a claim that every position now has the correct primary. Review used the existing 201 tactical/positional course exercises, 24 reached positions from eight generated engine games, twenty real-game rare-theme cases, ordinary-game controls and 32 frozen mistake-priority judgements. No new random sample was added. Generated engine games are not human-game samples; paid course inputs remain private.

## Chess review

- A course continuation advertised a pinned pawn as won after Qd5+ Kh8 Qxb7. The opponent can capture a different pawn with Qxh3 and create a mating attack. Fresh depth-16 estimates put Qxb7 at -405 cp for White, whereas alternatives retain an advantage. The Pin badge is removed at its actual ply; the original root was already unverified and receives no invented replacement.
- In another course ending, Rxh2+ geometrically skewers the king and b2 pawn. After Ke3 Rxb2, Nxc5 countercaptures elsewhere. Its local bound falls from 200 to 100 cp. Fresh Stockfish selects Nxc5 in that reached position. The root Attraction and the actual-ply secondary Skewer remain; a bounded material certificate is not the full-position evaluation.
- In real Lichess case ZVq1J, Nxc4+ opens the rook's check and attacks the queen. A smaller king-front skewer of the same attacked e3 pawn is a subset of that discovered attack, not another lesson. Discovered Check remains at the actual fifth ply and the duplicate Skewer disappears. Reaching that board directly gives the same result.
- A constructed control moves the rear victim off the knight's attack and protects the pieces needed for both mechanisms. Discovered Check guarantees 680 cp; the distinct Skewer guarantees 100 cp. Previously the fixed theme-name order put Skewer first. The larger direct attack now leads, while the distinct smaller ray remains secondary in classification, missed-opportunity explanation, the panel and board labels.

Counterexamples matter as much as these positive cases. An older test expected a supported bishop's skewer to win because Qxd3 cxd3 works. Qh5 instead permits Bxh7 Qd1#. Fresh engine verification confirms mate in one, so the old expectation was corrected, not restored. Conversely, Bd3+ winning a queen into K+B versus K is a genuine drawing rescue: terminal insufficient material must not erase its skewer. Stockfish reported +15 cp in that known drawn position; the terminal board, not exact centipawn equality, establishes the draw.

A proposed queen-liability negative control was rejected after fresh analysis found Qxa8 instead of the losing Rxa8. A second king-front reduction still wins through intermediate queen checks; its valid checking recovery is explicitly retained as a positive regression. A separate legal queen-front control verifies the off-square queen countercapture without assuming removal of the knight makes every other defence disappear.

## General changes

Pin/skewer material leaves now debit all friendly pieces, not just the captured square. They check immediate mating and promotion resources within the existing shared 4,096-visit proof budget. The checking/interposition continuation remains available under its existing bounds. Unknown or exhausted proofs abstain.

A ray-specific material mode retains actual capture values at terminal mate/insufficient-material leaves. It does not substitute the artificial 10,000 cp mate marker to fund a material pin/skewer, and it does not reject a legitimate queen-winning drawing rescue. Other terminal draws still fail this material route. Cache keys separate this mode from the existing fork/mate proof behavior.

Duplicate suppression requires a separately re-proved, high-confidence material discovery on the same move, its actual revealed checking ray, and every relevant skewer's rear victim within that discovery's targets. Different rays/victims and mate-only certificates are not swallowed. For distinct same-move direct mechanisms, a pin/skewer at least a pawn smaller than an independently verified fork/discovery is ranked secondary. Per-item ranks preserve comparator transitivity; later plies and causal preparations keep their existing ordering.

## Verification

Thirty-five fresh depth-16 searches completed across four private reports, including the contrary constructions above. An earlier seven-of-eight exploratory report is retained separately: it stopped at an inappropriate exact-zero engine assertion for a legally drawn ending, not a failed chess proof. The final drawing check makes no such engine-score assumption.

Ten new source/review tests and one rendered panel regression pass within **1,500 tests**, with 91 conditional skips across 107 selected files (105 passing). Twelve final exact-replay/ray checks pass separately. Whole-project type checking, seven-file lint, shared-review build (40 modules), app build (8,870 modules), three built-service tests and two development-cache/recovery scenarios pass.

Exact-input replay leaves all 225 source results unchanged. Only the two described course live continuations change; all 201 course primary-ID lists, 24 generated-game full results and 32 frozen priorities are unchanged. Nineteen of twenty rare full results are unchanged; ZVq1J loses only the overlapping secondary skewer. These are stability results, not independently adjudicated correct negatives or accuracy gains.

All 640 actual-controller production-worker inputs pass thirteen tests against liveTactics.worker-CeX7PLax.js. The [177-input public receipt](built-worker-adapter89.json) records median/p95/max elapsed time 78/237/568 ms, maximum startup 37 ms and maximum computation/transfer 543 ms, excluding engine/UI and additional private/rare inputs. All 168 prior public primary-ID lists are unchanged. Nine new worker controls check rejected rays, drawing rescue, checking recovery and primary/secondary selection across the real worker boundary.

No owner app, native package or service was restarted or deployed. Six isolated cold HTTP cases pass under unchanged deadlines: first/next startup 1,374/65 ms; exact KPK startup 1,946 ms and computation/transfer 503 ms. These do not establish stable startup or native WebView reliability.

Broader quiet combinations, causal comparisons, positional pressure versus forcing tactics, drawing/larger-ending zugzwangs and native UI verification remain incomplete. Existing interference and exact KPK coverage is preserved, not expanded by this ray-focused milestone. A geometric motif with no supported gain must still abstain; abstention is not evidence that the position has no tactical idea.

Private receipts in Documents/OnCrescent Tactical Benchmarks: adapter89-pin-initial-engine.json (8 searches), adapter89-ray-final-engine.json (18), adapter89-corrected-skewer-engine.json (5), adapter89-nonking-skewer-engine.json (4), adapter89-skewer-control-engine.json (partial exploratory), adapter89-final-exact-replay.json, rare-theme-adapter89-final.json and adapter89-final-cold-http-worker.json. Earlier contrary replay reports are preserved.
