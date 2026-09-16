# Branch-dependent mating moves and preserved winning choices

Adapter **130 / live pipeline 135** recovers a missing mate from two newly
sampled owner games, while preventing stronger mate verification from adding
duplicate headlines or accusing a different forced mate of missing the win.

## Whole-game chess review

The latest two games by end time in the fixed August archive were chosen before
reading classifier output, without result/theme filtering. All **92 pre-move
contexts** received fresh depth-16 MultiPV3 searches. Initial board judgements,
contrary results and exact owner data remain private. This is development
material, not a holdout; one f7 mating board overlaps an older public fixture.

The genuinely missing rook check now receives **Forcing Mate within four**.
Depending on the king's reply, the knight move which gives check in the supplied
line is instead a quiet mating setup. Some branches need two quiet moves although
the supplied line needs only one. The earlier verifier forbade these branches.
The move was played, so it is not a missed-opportunity accusation. The preceding
move gains a neutral opponent-mate explanation; the independent better-move
comparison remains unproved.

A later nonchecking pawn capture also forces mate, rather than merely winning
the knight. The already-existing all-defence mate-in-three verifier now covers
that nominated capture route. Its faster alternative is not a missed win: review
independently verifies the played mating strategy before withholding missed
motifs. Local opponent counterplay stays in the secondary timeline, not as a
claimed tactical cause of a mistake which still forces mate. Five similarly
misleading explanations in the previous eight-game sample are removed.

Other initial judgements were corrected, not made into test requirements. A
proposed pawn fork allows a queen retreat exploiting a pin. My exchange-only
analysis missed an immediate queen mate that the classifier already found.
A proposed rook-check shortcut permits a rook capture and does not mate.
A quiet knight discovery/pin was already present in the played-line scan but
absent from the best-three live candidates; its queen-for-two-pieces accounting
and all 26 defences were reviewed. That nomination/primary-specificity gap is
not counted as newly recovered coverage.

## Search, relevance and proof boundaries

- The original economical mating search runs first. If inconclusive without
  exhausting its budget, a second pass permits the nominated checking moves
  to be quiet in other branches. Both passes share **65,536 operations** and
  the original depth; there is no deadline increase. A first-pass exhaustion
  still abstains. A line with no nominated quiet setup is unchanged.
- The first draft expanded immediately and exhausted the budget on an older
  f7 mate, producing six failing assertions. Staged search restores that mate
  in 50,042 visits while preserving the new four-move strategy. Expectations
  were not weakened to accept the missing mate.
- A shorter independently verified quiet mate subsumes a duplicate longer
  root certificate. Later mating mechanisms remain at their actual plies.
- Generic Forcing Mate roots now show only current-board arrows/labels, not
  an arbitrary future king route or a terminal pattern on the starting board.
  Specific same-ply supporting geometry and full timelines remain available.
- Played-mate equivalence uses legal all-defence proof, not mate scores or a
  centipawn cutoff. Truncated/cooperative lines and an added capturing defender
  cannot borrow another input's certificate. An older castling test expected a
  missed win even though its Re3 alternative mates in two; the full defensive
  tree and fresh engine query support correcting that expectation.

The public constructed controls include both colours, a capturable checker,
king flight, countercheck, missing nomination and fifty-move claim. **The flight
and countercheck boards still have longer engine mates**; withholding their
supplied mate-in-four is not evidence that they contain no tactic. Root-only
input also misses the real mate. These are explicit remaining coverage limits.

## Independent evidence and regressions

Two legal-rules libraries, chessops and python-chess, replay complete defensive
trees, including promotion choices and terminal mates. The new real root has
67 defensive nodes/48 mating leaves; its reflection has 203/176, so checking-root
ordering is not colour-symmetric in work used. Both fully verify. The public
counterpart has 73/56 in either colour. The independently checked played choices
which no longer receive missed-mate blame include trees up to 1,003 nodes and
442 leaves. These are certificates, not independent game counts or shortest-mate
proofs; source and engine nominations may yield different valid upper bounds.

There are **277 fresh engine searches**: 92 whole-game roots, 34 focused chess
decisions, 26 initial strategy/control probes and 125 additional selected root
answers. Repeated/reflected decisions are included. All 125 additional decisions
retain a positive mate estimate. Only constructed rows are published in
`branch-quiet-mate-stockfish-18.json` and
`branch-quiet-mate-alternatives-stockfish-18.json`; owner/course data stay private.

The final selected source run passes **2,492 tests** with 196 optional skips
across 166 files. TypeScript, scoped lint, the generated 43-module review service
and frontend build pass. All 246 private and twenty rare-theme motif results
remain unchanged apart from versions; eight private and two rare live results
change only starting-board annotation. These are stability checks, not accuracy.
Public compiled-worker checks pass 28 groups; all 1,043 previous ordered primary
lists are unchanged by identity/lane. Compute/transfer median/p95/max is
39/192/1,153 ms, excluding engine search, startup and native rendering.

All **193 forced-cold HTTP inputs** pass. Server startup is 3,464 ms; first/max
worker startup is 1,486/1,974 ms and maximum compute/transfer is 1,345 ms. The
initial harness expected a terminal corner-mate label on the root board; that
expectation was corrected and the actual-ply terminal theme explicitly checked.
The cache suite initially lacked Node's experimental VM-modules flag; with the
documented flag both cases pass. Ten generated-service tests pass; its optional
real-engine case was skipped. These are not native startup guarantees.

The immutable worker is `liveTactics.worker-DkX1bBKr.js`, SHA-256
`67c8f3a00cda31919c9375b2117727f09b2cd67981d3f75cefde9841f35a50cf`.
All 512 owner inputs match their source scans through the compiled controller:
217 original, 122 disjoint, 81 third-sample and 92 August contexts. Exact-input
comparison with adapter 129 changes 22 full rows: thirteen only in board
annotations and nine substantive rows. These include adjacent contexts and
repeated stages of the same combinations, not nine independent discoveries.
Six false missed-mate explanations across two games are removed. The latest
principal live mate recovery is one genuine previously missing root lesson.

The public engine-receipt regressions match all 46 constructed search decisions
to their exact boards and currently selected moves; receipt existence alone is
not accepted. The final focused run passes 100 tests with eight optional skips;
whole-project TypeScript and nine-file scoped lint pass again. Desktop-package delivery is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`; at the source milestone the package remains
adapter 129. No browser automation, owner-app restart or phone-service
deployment is implied by these checks.

Broader recall, quiet preparations, primary-theme judgement, full-position
compensation, earlier repetition history and load-sensitive native startup
remain open. This milestone does not complete the user's accuracy goal.

## Follow-up: the missing defensive explanation

After desktop delivery, nine fresh private depth-16 searches examine the move
preceding the recovered mate. The played move allows mate in four. The suggested
knight development instead guards the rook's entry square: the same rook check
can be captured by the knight, and a rook recapture with check can be answered
by the king. That recapture is an illustrative legal branch, not forced play;
the unrestricted engine continuation after the first capture chooses a quiet
knight move instead.

The better move still leaves the defender materially worse (-389 cp in the
held search), while the same rook attack after that defence gives the defender
a winning engine estimate. These finite-depth scores corroborate a concrete
refutation of this particular entry; they do not prove the absence of every
longer mate. The current comparison intentionally remains unconfirmed.
`compareImmediateTacticalDefence` handles terminal mates, but has no general
positive capture-defence comparison for longer mating roots. Its existing
`checkingAttackerCaptureEscape` helper also excludes an entry that still gives
check and only covers a bounded king-flight continuation. Simply treating a
failed mate search as prevention would restore false causal explanations.

Private receipts `branch-mate-cause-probes-20260916.json` and
`branch-mate-cause-engine-20260916.json` retain all nine legal probes and completed
searches. This is a verified next causal-coverage target, not a further classifier
fix, nine newly discovered tactics, or an accuracy score. Source and desktop
remain adapter 130 / pipeline 135; the opt-in decision audit passes.
