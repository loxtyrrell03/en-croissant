# Checking-fork defence and broader owner-game audit

Adapter **134 / live pipeline 140** recovers a missing mistake cause, not a new
live fork detector. A legal capture of the forking piece can now explain why
the better move prevents an ordinary checking fork even when both geometric
targets remain on the same squares.

## Chess finding and implementation

In the newly sampled Italian game, ...Qc5 permits Nxc7+ and Nxa8. The classifier
already found the fork but left its causal comparison unclassified. ...Qd6
instead guards c7: Nxc7+ Qxc7 loses the knight for a pawn. The queen on c5 cannot
do the same because its own knight on c6 blocks the file.

The new witness requires an independently proved immediate original fork and
a legal capture of its checking attacker in the comparison position. It uses
the existing all-friendly-piece capture-safety calculation, including legal
recaptures, immediate mate/promotion liabilities and one countercheck response.
It subtracts the fork's initial capture and credits material taken by the
player's original choice before establishing a net loss. A failed attacking
proof, geometric defence, missing line or exhausted budget cannot establish
prevention. The witness has a shared 4,096-operation limit; scan deadlines,
engine searches and live nomination rules are unchanged.

Controls reject capturing the knight when that loses the queen to an allied
bishop, when the knight already took a rook, and when the player's earlier
queen capture outweighs the fork. Colour reflection and exhausted-budget
checks are included. A generated-service regression checks the explanation
through actual card creation, shared deck storage and reload.

Twenty-eight fresh Stockfish 18 depth-16 searches cover the real decision,
all three legal responses to the actual checking fork, the defensive capture,
its selected Bxf7+ / Qxf7 countercheck answer and two constructed controls.
The real unrestricted/held ...Qd6 estimates are -238/-255 cp for Black, versus
-467 for ...Qc5. After ...Qd6, the held Nxc7+ is -224 for White; Qxc7 is +226
for Black. These independent finite searches are not exact minimax bounds or
the local material certificate.

The stripped-down fixtures are **not additional good game recommendations**:
Black has a major material advantage and stronger mating moves. Even the
queen-losing control remains winning for Black overall. They isolate the local
mechanism and distinguish a favourable position from a sound capture claim.
Two initial fixture king placements made the desired replay illegal; legality
checks caught them before the final valid baseline reproduced the missing
comparison in both colours.

## Whole-game scope and corrected judgements

- All **164 plies of three July games** were frozen by archive end time before
  engine/classifier output. This includes a short Italian, a 57-move game with
  queen mistakes and a promotion ending, and a short queen/rook mating game.
  Initial chess hypotheses were recorded privately. The complete audit used
  **162 distinct fresh searches**; shared exact opening positions are cached.
- The remaining August game contributes **44 plies / 45 fresh searches**. It
  overlaps the earlier ordinary-game public audit, discovered after sampling,
  and is explicitly regression evidence rather than a new independent game.
  The requested three remaining August games did not exist: the archive had
  three total and two were already in the owner sample.
- The August Qxc6+ example is mate in three, not primarily a rook fork. Existing
  mate priority was correct. Its Bxg5+ discovery also correctly distinguishes
  a more costly existing attack from newly creating the threat.
- In the July Italian, Nxd5 is a pawn capture with tempo, but the future rook
  fork is not forced while ...Qd6 is available. The fork only becomes the
  supported loss after ...Qc5. Loose bishop/queen captures and the short mates
  inspected in the other games were already recognised; they are not new
  recoveries attributable to adapter 134.
- The longer July game retains substantive gaps: Rg3's long mating attack,
  several rook-ending checking plans, and the queen liquidation leading to a
  drawn king-and-pawn ending remain incompletely explained. A promotion can
  occur in a losing position, and a check can merely postpone promotion;
  neither observation alone establishes a new mistake cause.

The preceding capture diagnostic joined each candidate to the actual retained
full-history scan: 31 positive local capture candidates had no immediate motif
across the old 512 contexts. Most obvious piece captures were recaptures or
exchanges, not 31 newly missing tactics. No blanket capture-admission change
was made. Persistent-pawn history can still be too conservative around unrelated
earlier exchanges; this remains an investigation, not a certified fix.

## Verification and delivery

The final 720-context exact replay comprises the earlier 512 owner contexts,
164 July contexts and the overlapping 44 August contexts. Only the Italian
queen decision gains its causal fork explanation; all live results are
unchanged. All 246 private course and twenty rare-theme full source/live
results remain unchanged, ignoring versions. Stability is not an accuracy rate.

The selected source suite passes **2,552 checks**, with 207 optional skips,
across 173 files. A focused source/renderer/review run passes 98 checks with
three optional skips; these counts overlap. TypeScript, scoped lint, generated
review and frontend builds pass. Twelve generated-service checks pass with one
optional real-engine check skipped. The earlier broad run loaded source before
the choice-credit safeguard while seeing the subsequently added control; that
control failed. The final source run includes the safeguard and passes.

The actual compiled worker/controller passes all 720 owner inputs and 164
fresh targeted July inputs. Maximum startup/computation is 36/1,436 ms,
excluding engine searches, HTTP loading and native UI. Two earlier 720-input
runs exceeded the test's aggregate 120-second allowance, not a recorded
per-input controller failure. The harness now allows 300 seconds for this
growing batch plus its source recomputation; production startup/computation
limits remain 20/3 seconds. The final two-group run completes in 205.53 seconds.

The 164-position July targeted audit used 239 fresh searches. Existing live
nomination recovers four otherwise empty principal displays: cxd4, Qxf5 in
two adjacent positions and Qxh2. These are three pawn targets, not four newly
implemented mechanisms; cxd4 remains a losing position, and the later Qxf5 is
substantially weaker than the principal checking attack. Local pawn retention
is not a full-position win or proof of the best instructional headline. The
44-position August targeted replay used seventy fresh searches and is still
overlapping regression material.

Clean desktop delivery remains separate; no native-window or cold-start
reliability claim follows from source or package checks. Automatic targeted candidate acquisition in mistake
review, broader recall/primary selection and the historical startup delays
remain open. Paid course data and owner-game reports stay outside Git.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`:
`chesscom-july-three-20260916.json`, its initial-judgement and adapter133 audit;
the analogous August-third audit; `checking-fork-guard-{probes,engine}-20260916.json`;
`fork-guard-owner-final-adapter134-20260916.json`; `adapter134-{private,rare}-verified.json`;
and `adapter134-tests-final-20260916.json`. Source and targeted candidate scans
have separate receipts; no changed search result is attributed to this patch.
