# Mating mechanisms without competing headlines — adapter 96 / live 101

## Scope and evidence

This follows the [twenty-three-position cross-phase review](cross-phase-relevance-review.md). It addresses missing secondary mechanisms in three already selected real-game positions; it is not a new output-blind sample or a representative accuracy result. The earlier chess judgements and adapter-95 outputs remain unchanged as historical evidence.

The [public engine receipt](mating-mechanism-stockfish-18.json) contains **37 final fresh depth-16 Stockfish searches**: three real roots, complete root/selected-continuation defence checks, fixed witnesses, missed moves, eight constructed controls and one contrary initial pin proposal. Repeated root/witness searches are not independent puzzles. An earlier 29-search audit is retained privately. The exporter checks exact known inputs, complete legal PVs, all root replies, every intervening evasion and actual terminal mates before exporting public fields; no paid positions are included.

## Chess decisions

### 49h84: a king can leave one defence while blocking another

After **R1e6+ Kg5 Rxg7#**, the primary lesson remains **Forcing Mate**. The existing first-move mating deflection explains why Black's king must leave its defence of g7. The missing secondary mechanism is **Kg5's self-interference**: it blocks Rg4's line to g7. Both are genuine, distinct reasons that the final capture mates, but self-interference belongs to the defensive move at ply 2, not the starting board or a tactic won by Black.

The previous protection test required the rook to recapture legally on the pre-evasion board. That board still had the unrelated check from Re6 against Kf6, so it rejected the guard for the wrong reason. The new bounded fallback instead checks that the actual new blocker is the only obstruction on the guard's line and that the guard's recapture would leave its king safe on the resulting mating board. The king stays on its actual square, including when it is the blocker. This is an explicitly hypothetical occupancy/king-safety check, **not a legal variation**, and cannot prove a root tactic by itself. The final capture must independently be actual checkmate. The existing 512-operation bound is unchanged.

Stockfish confirms the root mate in two and the exact reply's mate in one. The legal missed move R1e3 is approximately equal (-26 cp for White in the final search); missed-mate review keeps mate primary and self-interference at ply 2.

### qY3NM: deflecting a blocker opens the attacking route

**Qxf6+ Rxf6 Rxe8+ Rf8 Rxf8#** is still mate in three. The queen offer deflects Re6, opening Re1's approach to e8. This is more precise than the initial hypothesis that Re6 merely guarded e8: with that rook restored on e6, Rxe8 is blocked and illegal. The detector now distinguishes opening the approach from removing a defender of the final mating square.

Acceptance need not lead to immediate mate. The new branch verifies the checking entry Rxe8+, all legal evasions and the actual mating answer after each. Here **Rf8** is the only evasion, followed by Rxf8#. The other root reply, **Kg8**, is separately met by **Qg7#**. All two root replies and the intervening block share the unchanged 8,192-operation budget; the complete proof uses **493 operations**. No supplied future PV is needed to nominate this proof.

The initial decline witness Qf7+ retained a small material bound but was less useful than the available immediate mate. The final proof chooses Qg7# for this branch. When every branch mates, the secondary evidence is **Mating Deflection**, not an extra pawn gain or a generic Sacrifice badge. Its root evidence has no spendable material value. Timeline normalization retains the established mate marker, not an additional material reward.

An intermediate candidate exposed an existing priority trap: giving the support mechanism a root mate-value sentinel displaced the independent Forcing Mate headline. The frozen cross-phase replay caught that regression. Final root-only and full-line results retain mate in three as primary, with deflection secondary. The default board shows Qf3–f6 and the blocked Re1–e6 approach, replacing five future-line arrows with two relevant arrows. It keeps one primary label; the conditional block and mate remain in the continuation.

The final engine searches independently confirm mate in three at the root, mate in two after Rxf6, and mate in one after Rf8 or Kg8. The legal missed move Qd3 draws in the finite search.

### kO37k: clearance and deflection support the same mate

The same general extension also recovers deflection in **Qxf7+ Rxf7 Rd8+ Rf8 Rfxf8#**. Qxf7 clears d7 for Rd1 and draws Rf8 away from guarding d8. Here restoring the defender permits a legal capture on the checking square, unlike qY3NM's blocked approach. Black's alternative **Kh8** allows Qxf8#.

Both root replies and the intervening block are covered in **174 of 8,192 operations**. Fresh searches confirm mate in three/two/one along the selected branches; the legal missed move Qa7 is +1 cp. Forcing Mate remains primary; Mating Deflection replaces generic sacrifice noise, while the independently verified Mating Clearance remains secondary. The default board retains its existing compact clearance geometry rather than adding another competing label or all later mating arrows.

## Contrary controls and limits

- **Absent guard:** removing Rg4 from 49h84 still leaves mate in two, but there is no rook line to interrupt. Rejecting self-interference here does not mean rejecting the mate.
- **Pinned guard:** replacing Pg3 with Qg3 still leaves the actual Rxg7 mate, but a hypothetical Rg4–g7 exposes the king to the queen. The extra self-interference claim is withheld. The first proposed pin control merely added Rg1 behind Pg3; the pawn blocked that rook, so it was not a pin. Its contrary mating search is retained, not used as a negative fixture.
- **King flight:** removing h5 permits Kh5 after Rxg7+. The position still has a winning material attack (+434 cp at the root), not the advertised mating self-interference.
- **Second guard:** adding Rg8 permits Rxg7; the proposed root attack evaluates -601 cp. Both legality and the missing mate, not just the score, defeat the claim.
- **Missing approach/support:** without Re1 there is no cleared rook entry; without Rd7 the king has an escape. The proposed queen sacrifice loses. These controls do not redefine any losing full position as necessarily tactic-free.
- **Extra receiver:** a rook on f7 supplies another acceptance and keeps the original blocker. Every acceptance must be covered, not merely the source game's Rxf6 branch.
- **Guarded finish:** Ng6 permits Nf8 against Rxe8+, and even the source Rf8 Rxf8+ continuation allows Nxf8. Checking only the first entry or a cooperative mate would falsely accept this offer. The final root search is -938 cp.

All eight mechanism controls are rejected by the relevant certificate. Tests cover complete reply sets, actual final captures, absent/pinned guards, extra receivers, root-only input, reflected colours/files, invalid/partial budgets, missed-mate review, rendered ply ownership and compact board projection. The new continuation remains bounded to one further check and mate after accepting a checking offer. Existing immediate-mate offers and material-preserving declines are retained. Worker deadlines and the broader proof budgets are unchanged.

## Verification and delivery

- **1,788 selected source/review/render tests** pass, with 96 conditional skips (115 files, 113 passing). This includes 37 new ordinary mechanism tests and three rendered explanation tests. Conditional engine/export runs are separate.
- **881 actual-controller production-worker inputs** pass across fourteen tests. The [376-input public receipt](built-worker-adapter96.json) measures median/p95/max **74/198/615 ms**, maximum startup 33 ms and maximum classification/transfer 588 ms, excluding engine search and native UI. The common 362 inputs measure 75/198/615 ms; no speedup claim. All 362 earlier primary-ID lists are unchanged.
- Shared-review (40 modules) and app (8,870 modules) builds, whole-project TypeScript, eleven-file targeted lint, three built-service tests and two development-cache/recovery scenarios pass. Artifact: `liveTactics.worker-d_cvsJOU.js`.
- **Twenty isolated cold HTTP cases** pass. First/next startup is **1,360/66 ms**, with KPK startup reaching 2,030 ms. New mating-deflection startup/classification is 64/64 ms; the actual-ply self-interference case is 60/31 ms. Earlier multi-second variability remains contrary evidence, not a loading-delay fix or native WebView guarantee.

All **246 exact private course/generated-game source/live results**, **20 earlier rare full results** and **32 frozen primary-priority judgements** are unchanged. Only the three reviewed cross-phase explanations change; the other twenty full results and all twenty-three primary-ID lists are unchanged. Their [final exact replay](cross-phase-adapter96-review.json) preserves the complete results. Stability is not accuracy, and the new mechanism controls do not establish tactical absence across whole positions.

Authoritative private receipts are `adapter96-final-mating-mechanisms.json`, `adapter96-final-mating-engine.json`, `adapter96-final-exact-replay.json`, `rare-theme-adapter96-final.json` and `adapter96-cold-http-worker.json`. Earlier candidate proof, engine and board-output reports remain private as contrary evidence. No owner app/package/service was restarted or deployed; native/physical interaction is not claimed. The five unresolved cross-phase puzzle roots, including six-piece zugzwang, and broader quiet/positional/endgame/causal coverage remain open.
