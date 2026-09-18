# Saving-check recall in three further owner games

Adapter **161 / live pipeline 168** recovers short queen perpetuals previously
missed by the bounded search. The review also stops calling a drawing resource
missed when the played move is equal, non-losing or independently repeats.
This is a recall improvement, not completion of broad tactical accuracy.

## Games and chess judgments

Three next eligible June games were selected by end time, excluding the nine
previously sampled June games. Initial board/move judgments preceded engine and
classifier output. All 232 plies were retained; the report records 230 fresh
engine searches, with consecutive/repeated positions shared. The combined
corpus now contains 30 games and 1,551 contexts. Owner boards and detailed
judgments remain private, not copied into repository fixtures.

The new review includes correct king/rook forks, a dropped queen, a loose rook
captured with check, and ordinary developing/exchange moves. It also corrects
initial hypotheses: an apparent ...Qxc3+ king/knight fork permits Nc2 with a
mating counterattack; an apparent ...Nf2 rook fork has checking counterplay.
Attacking two pieces and seeing one taken in the game is not a complete proof.

The actionable new gap is the late queen ending. ...Qb1+ can maintain checks
against both Kd2 and Ke2, but the latter needs a different checking route.
The original production search exhausts its allowance without identifying it.
The actual ...Ke3 instead exposes the queen to Rxa2. An earlier ...Qb2+ is
also a repeatable resource; the played ...Qa2+ is independently evaluated equal,
so choosing it must not be described as missing the draw.

Fresh depth-18 analysis gives zero for the saving roots and the drawing
alternative, while ...Ke3 allows forced mate. Scores nominate relevance, not
the repeatable strategy. Every legal defence in the recovered strategy is
independently checked. The displayed example continuation is not the proof.

## Implementation and primary lessons

- Geometric check nomination avoids spending visits on quiet moves. Reached
  boards must still actually be in check.
- Exact path-closing or mating checks are tried before deeper checking detours.
  Short-to-long attempts share the same **4,096-operation** budget and unchanged
  maximum of five further checks. No defensive branch is omitted; no cached
  result from another path establishes repetition. Exhaustion stays unknown.
- The real roots succeed with root-only input in 2,744 and 2,845 visits; the
  supplied-line searches use 1,022 and 2,124. Hints affect ordering, not validity.
- Optional audit witnesses export every defence and selected checking answer.
  Normal scans neither build nor transfer these trees. The shared-budget and
  moved-checker-only modes remain available to defensive deflection.
- Missed-perpetual accusations require finite losing played-move evidence and
  a meaningful loss (at least 50 cp, with played score below -50 cp for the
  mover). Unknown/equal/non-losing metadata cannot establish that accusation.
  An independently proved played perpetual overrides contrary score metadata.
  This qualification applies to main, alternative and timeline missed lessons;
  it does not hide the available live drawing resource.

Exactly six full owner rows change relative to the frozen adapter-160 inputs:

- Two previously empty live roots gain Perpetual Check.
- The preceding missed mate-in-two remains primary, with the allowed draw second.
- An equally drawing choice is not blamed for missing a perpetual; an adjacent
  unproved causal comparison remains a neutral position observation.
- The queen-loss mistake keeps Hanging Piece primary and the missed saving
  checks secondary, rather than replacing the obvious blunder with the resource.
- Two old rows identify an already present continuation perpetual earlier.
  Their primary lessons are unchanged, including the stronger forced mate.

These rows overlap in their tactical mechanism; they are not six independent
new tactics. The other 1,545 full results are unchanged apart from versions and
timing. All 246 private course/generated-game results and twenty rare-theme
results are unchanged, as are all 808 prior public worker primary lists. None
of these stability counts is an accuracy rate.

## Contrary controls and verification

Constructed five-piece controls reproduce the search issue in both colours and
file orientations. Adding a bishop that captures the checker refutes the
resource even with a supplied zero score. Relocating the distant white queen
also removes the established draw; a different king relocation does **not**,
and is retained as a non-refuting control. Early proposed alternate-check
fixtures did not establish complete strategies and were not treated as positives.

An independent python-chess verifier checks eight unique complete strategies:
68 legal defence/answer edges and 34 path-local cycle leaves. It rejects 24
tampered witnesses with missing defences, false cycles or wrong positions.
The 76 fresh follow-up engine searches reconcile exact requests, depths and
held roots; 100 returned lines / 931 moves legally replay. Engine estimates
remain separate from the independently verified checking strategies.

- Broad selection: 2,921 passes, 353 conditional skips, including the retained
  expected coverage failure. Final source/React selection: 161 passes and six
  conditional skips, including the newly rendered resource/current-board arrows.
  The selections overlap and are not independent chess judgments.
- Generated shared review: 36 passes, one optional engine skip. The queen-loss
  primary and missed perpetual survive storage/reload in both colours.
- Types, scoped lint, review/frontend builds and two dev-cache recovery tests
  pass. The primary frontend build includes unrelated changes and is not used
  as the clean delivery source.
- Compiled controller: **2,363 inputs** (808 public, 1,551 owner, four new
  positive/negative colour controls), with exact source parity. Public compute/
  transfer median/p95/max is 44/211/1,083 ms, excluding engine and native UI.
  Production startup/computation deadlines remain 20/3 seconds.
- The first forced-cold HTTP run timed out before receiving the worker bundle
  at 20 seconds. This is retained contrary startup evidence, not a classifier
  computation timeout or proof that native reliability is fixed.
  A retry started, but exposed stale HTTP expectations for two earlier mating
  recoveries. Both adapter-160 and adapter-161 compiled receipts already retain
  the same positive results; the HTTP expectations now match those established
  cases and identify failing cases by name. This is not a new chess recovery.
  The final cold run passes all 197 HTTP cases, including the new positive and
  capturable-checker controls; first/max startup is 951 ms, with separate server
  startup of 1,901 ms. That passing retry does not erase the initial timeout.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`, dated
`20260918`, include `chesscom-june-fourth-initial-judgement`,
`chesscom-june-fourth-adapter160`, `perpetual161-owner-baseline`,
`perpetual161-owner-final`, `perpetual161-final-independent`,
`perpetual161-final-engine-reconciliation`, `perpetual161-tests-final`,
`perpetual161-public-worker`, `perpetual161-owner-worker`, and the cold-HTTP
failure/retry records. The opt-in audits and independent verifier preserve
reproduction without publishing owner positions or paid course content.

The exploratory two-pawn-fork expansion was withdrawn: its proved examples
were later conditional lines or an already strongly winning root, not the
missing immediate explanations sought. Its opt-in inventory remains diagnostic;
no production pawn-only fork rule was added.

## Remaining work and delivery boundary

The older Re8+ saving-check resource remains incomplete. The new games also
expose an unresolved capture/attraction/check/bishop-trap preparation and a
long mating root whose explanation still leans on a late mechanism. Broad
recall, primary-theme judgment, longer counterplay and native startup remain
open. No owner stores were rescanned and no app or phone service was restarted.
Clean standalone packaging is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`.
