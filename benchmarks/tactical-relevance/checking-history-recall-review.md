# Checking pawn captures with complete exchange history

Adapter **132 / live pipeline 138** removes the blanket exclusion of checking
captures from the complete-history pawn-opportunity rule. The same exact-history,
exchange-debt, finite-evaluation and bounded local-safety checks remain. Giving
check does not make a separately established pawn capture disappear, and does
not prove a fork on another piece in a displayed continuation.

## Owner-game judgement and contrary evidence

In one previously frozen August game, **Qxg2+** is a sound pawn-taking alternative
to the preferred checking bishop move. It also moves the queen out of attack.
The actual **Nbc6** leaves that queen loose; **Nxg5** remains the primary mistake
cause. The pawn capture belongs to the separate missed-option field, not the
preferred bishop variation or a claim that it explains the entire evaluation
loss. Playing Qxg2+ cannot become a missed-Qxg2 accusation.

The old displayed continuation **Qxg2+ Ke1 Qxh1+** tempts a false king/rook-fork
explanation. **Nf2** is a legal check block which keeps the rooks connected.
**Kd3/Ke3** also leave the rook defended, although the king walk permits other
attacks. Therefore this milestone does not add a forced rook win. Ke1 really
does block one rook's defence of the other: that independently checked
Self-Interference remains secondary at ply 2. The pawn-only timeline keeps its
short boundary, permitting only this actual immediate check-evasion mechanism;
it does not reopen the whole speculative engine line. Root arrows still show
only the pawn capture.

Eleven fresh Stockfish 18 depth-16 searches cover unrestricted/held/played roots
and every one of the four legal defences, both held and followed by a new answer
search. Held Qxg2+ scores +1061 cp for Black versus +1185 for the unrestricted
bishop check and +546 for the played knight move. Nf2 preserves a large Black
advantage but defeats the simple rook-capture story. The king walks return mate
in four/five in those searches; they do not prove mate against every defence.
These full-position estimates are not the local 100-cp pawn bound.

The frozen unrestricted input ranked the pawn option exactly 100 cp behind the
principal; the fresh restricted estimate is 124 cp behind. Candidate thresholds
are unchanged. Consequently the cached-input missed-option recovery is not a
claim that every fresh search will nominate the same secondary lesson. Broader
candidate acquisition and ranking remain separate work.

## Verification

- Exact-input replay covers all **512 contexts from ten existing owner games**.
  One row changes in live alternatives and mistake explanation; the principal
  live headline and primary queen-loss cause remain unchanged. The other 511
  full results are unchanged, not certified correct negatives.
- Eight constructed full-history cases cover both colours, a safe checking pawn
  capture, a pawn guard able to capture the queen, sacrifice recovery and an
  unsound f7 offer. The recovery case keeps its separately proved king/rook fork;
  rejecting generic pawn profit must not erase another genuine tactic.
- Two constructed timeline checks preserve actual defensive interference and
  reject it after a different evasion. The opted-in owner regression checks the
  missed option, primary loss, separate line and played-option ownership.
- The broader capture change passes **2,538 tests** (203 optional skips).
  After the timeline refinement, **259 related checks** pass (66 optional skips),
  plus the 43-check opted-in history/candidate selection. Counts overlap and must
  not be added into an accuracy figure. TypeScript and scoped lint pass.
- Eleven generated-service storage/review checks pass, with one optional native
  engine case skipped. The 43-module service and main-worktree frontend build
  pass. The latter includes unrelated local changes and is not delivery input.

Private receipts remain under `Documents/OnCrescent Tactical Benchmarks/`:
`owner-candidate-review-audit-20260916.json`,
`owner-candidate-review-checking-{probes,engine}-20260916.json`,
`checking-history-owner-timeline-final-20260916.json`,
`adapter132-tests-final.json` and `adapter132-timeline-tests-final.json`.
The first whole-game diagnostic accidentally supplied history to the historically
context-free source lane; it is retained as a draft, not used for the one-row
differential. The final replay restores the original source inputs exactly.

Compiled-controller and clean desktop delivery receipts are recorded with the
delivery milestone in `docs/TACTICAL_DESKTOP_DELIVERY.md`.

## Limits

Complete game history is still required for this generic older-pawn route.
Local capture safety checks immediate liabilities and bounded counterchecks,
not every longer attack or positional compensation. This is one recovered
opportunity in a reused development corpus, not a general recall/accuracy rate.
No candidate/depth thresholds, operation budgets or deadlines increase. The
generic Ng5 primary, quiet preparations, automatic targeted mistake-review
acquisition and historical native/cold-start reliability gaps remain open.
No owner games, settings, running app or phone service are changed by this source
milestone; native-window interaction is not inferred from packaging.
