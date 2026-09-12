# Mating clearance: relevance and contrary evidence

Adapter 85 / live pipeline 90, 2026-09-12. This extends secondary-theme explanation, not the number of primary badges. It follows the separate [interference review](rare-theme-review.md) and [exact pawn-ending zugzwang work](kpk-zugzwang-review.md); drawing and larger-ending zugzwangs remain incomplete.

## Real-game judgement

The CC0 Lichess puzzle NrHkx comes from [this real game](https://lichess.org/m6XYFzNi#67). The supplied continuation is Be3+ fxe3 Rc5+ Bc4 Rxc4+ Kb1 Bd3#. My judgement is that **Forcing Mate** should remain the primary lesson, with **Mating Clearance** explaining why the bishop leaves c5 for the rook on h5. Clearance is not another independent material gain.

There are exactly two legal replies to Be3+. After fxe3, Rc5+ enters the newly cleared square and forces mate. After Kb1, Bd3# mates immediately without that rook route. The first attempted requirement that every reply use Rc5 was correctly rejected: Rc5 after Kb1 is not check, and fresh Stockfish evaluates it -234 cp for Black. The successful certificate covers both defences but attaches the clearance explanation only to the actual accepting branch.

The final legal proof uses 157 of its 4,096 operations and records seven distinct selected attacking answers across all defences. Stockfish agrees that Be3+ is mate in four; all seven selected answers retain mating scores. Its example takes Kd2 Rc2# at the end, while the course-like supplied line takes Kb1 Bd3#. Both are legal branches, not evidence that the defender must choose either one particular line.

Additional contrary controls matter:

- A black pawn on f5 still blocks the rook: the nominated Be3+ evaluates -594 cp Black and receives no clearance certificate.
- Removing the black b3 pawn creates an escape: Be3+ evaluates -706 cp Black and is not certified.
- Missing the mating move with Rh6 evaluates -502 cp Black. Mistake review keeps the missed mate primary and the clearance in the better continuation.
- Replacing the rook by a queen preserves the tested clearance mate, but Stockfish prefers Qg5+ mate in three over Be3+ mate in four.
- A constructed through-square route, Bxb2+ Rxb2 Ra4+ Ra2 Rxa2#, proves that clearance is not restricted to landing on the vacated square. Nxb2 is a faster mate in two in that construction, so Bxb2+ is a valid mechanism control, not engine-best play.

Early hand-built controls also required correction for a countercheck, a friendly blocker and an extra king flight. Only legally replayed final positions entered the final engine audit; rejected constructions are not accuracy successes.

## What is actually proved

A checking move must vacate its square. An existing friendly rook, bishop or queen must gain a previously blocked route onto or through that square. At least one legal reply must permit a checking entry along that route; **every** legal reply must independently be mated within at most three further checking attacking moves. Distinct mating replies are described separately. The shared 4,096-operation cap is not increased per defence, and exhausted or invalid budgets abstain.

The supporting label requires the actual next two plies to match a certified reply and entry. Root-only or different continuations retain only what they establish independently. A moved piece that immediately uncovers the slider's check receives Discovered Check instead, or Double Check when both pieces check. Existing same-ply versions of those themes are retained instead of acquiring duplicate Clearance badges.

For a generic primary Forcing Mate, starting-board arrows show the triggering move and the cleared slider route. A supporting Clearance label may accompany the primary badge, but not a collection of future themes. Nearby same-rank labels are reduced to the primary badge to avoid obvious overlap; the supporting arrow and timeline remain. Show on board preserves both labels where applicable, and replacing the variation removes them. These paths have component/controller tests, not a physical WebView layout certification.

A fifty-move claim is considered on the defending turn. At halfmove 99 a legal announced non-capture/non-pawn move can claim before a future capture resets the clock. The affected mate-in-two/three, checking-mate and new clearance proofs now abstain there. Immediate checkmate takes precedence and a timely resetting move stays valid. This is not a complete audit of draw rules in every material/combination verifier; repetition claims cannot be reconstructed from a FEN alone.

## Six course mechanisms, three new lessons

The seven stored Woodpecker reports contain 180 development positions: 96 easy and 84 positional exercises. Six mating mechanisms were reviewed independently and all selected root/reached answers were searched afresh.

Three cases gain a supporting root clearance explanation while retaining their prior primary theme. Three others already explain an actual-ply discovered check or double check, which is more precise; the initial extra Clearance tags were withdrawn. A root Attraction plus Clearance also no longer acquires a redundant third generic Forcing Mate badge. The quiet/unsupported roots elsewhere are not declared fixed.

Relative to adapter 84, all 180 source and live primary labels are unchanged and 177 full source/live results are identical, ignoring classifier version fields. Among the original twenty rare-theme cases, only NrHkx changes supporting explanation/geometry and all twenty primary labels are unchanged. The 32 frozen primary/ownership judgements still match. Reused results, stable outputs and empty classifications are not held-out accuracy estimates.

Paid FENs, lines and detailed course reports stay in the private benchmark directory, not this repository. The exact private proof receipt identifies each source exercise and reached ply.

## Evidence and delivery boundary

The [public Stockfish 18 receipt](mating-clearance-stockfish-18.json) contains 32 final fresh depth-16 searches on CC0/constructed inputs. Nineteen additional fresh course searches are private: six roots/reached moves and their thirteen selected continuation answers. Earlier exploratory searches are superseded, not counted as additional final evidence. The final source-generated probe objects exactly match both certified engine inputs. Engine scores are full-position, side-to-move estimates; they corroborate but do not provide the runtime legal proof.

Authoritative private files in the existing OnCrescent Tactical Benchmarks directory:

- adapter85-exact-replay-final.json and rare-theme-adapter85-final.json.
- mating-clearance-adapter85-final-source-proof.json and mating-clearance-adapter85-final-source-engine-input.json.
- mating-clearance-adapter85-private-final-source-probes.json.
- mating-clearance-adapter85-stockfish-certified.json: 32 completed searches.
- mating-clearance-adapter85-private-stockfish-certified.json: nineteen completed searches.
- adapter85-shipped-cold-http-worker.json: final five-case HTTP receipt.

The final source/render/review selection has 1,423 passes and 75 conditional skips, with 28 additional regressions. The actual application controller passes 525 production-worker inputs across eleven tests. The [152 public inputs](built-worker-adapter85.json) have total median/p95/max 83/238/610 ms; startup max is 31 ms and classification/transfer max 582 ms. Engine search and UI rendering are excluded. Prior 146 public primary lists are unchanged. Artifact: liveTactics.worker-BBHefvmz.js.

Shared-review (40 modules), app (8,870 modules), three built-service tests, two dev-cache/recovery scenarios and nine-file lint pass. Whole-project type checking remains blocked by the unrelated OTB numeric/bigint fixture mismatch. Final isolated HTTP worker startup is 4,660/74/5,190/1,870/226 ms for Reti/f7/KPK/clearance/claimable-entry, with 8/127/497/49/8 ms classification/transfer. Server startup is separately 9,846 ms; these variable results are not a startup reliability fix. Deadlines remain 20 seconds for startup and 3 seconds for classification.

No running app, native package or service was restarted or deployed. Native WebView, physical-device and narrow-layout verification remain separate. Longer or quiet clearance, broader rare/causal coverage and larger/drawing zugzwangs remain open; this milestone does not declare the classifier complete.
