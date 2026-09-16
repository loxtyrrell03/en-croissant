# Recall-policy audit: old pawn opportunities and quiet fork repairs

Classifier **118 / live pipeline 123 is unchanged** by this audit. A broader
root-pawn admission draft was tried and withdrawn. The existing desktop package
remains the one documented in `docs/TACTICAL_DESKTOP_DELIVERY.md`.

The subsequent [fork-repair review](fork-repair-review.md) recovers tA2XR with
an independently checked allied repair, countercheck handling and mating
support. This audit preserves the earlier rejected pawn rule and missing-fork
evidence; broader persistent-pawn recall is still unresolved.

## Question tested

The old-pawn gate conflates two different questions: whether a material
opportunity is available now, and whether the preceding move newly caused it.
That can hide useful persistent captures. The trial admitted a pawn capture
when the supplied root engine score was finite and the existing bounded,
liability-aware direct gain reached a pawn. It did not add arbitrary later
PV motifs, change compensation rules or extend any deadline.

The same frozen six owner games (217 plus 122 pre-move positions), 246 private
course/generated-game inputs and twenty rare-theme inputs were replayed.
The owner trial added eight and three immediate root headlines respectively.
These are eleven changed root results, **not eleven certified new tactics**.
Larger piece-loss causes stayed primary and ordinary immediate recaptures
remained filtered. Two private live roots also changed: a pawn combination
and a Catalan pawn-recovery position. The rare sample supplied no finite root
scores, so its unchanged results are not evidence that the new gate is safe.

## Chess review and contrary results

- The two older Qxc6+ owner opportunities become visible, and the move that
  actually loses the queen retains that larger loss as primary. However,
  the first Qxc6+ versus f3 comparison is only -613 versus -622 cp in fresh
  held searches. The earlier separate-search apparent loss is not enough to
  call this a clear missed winning tactic. Local pawn availability and the
  primary cause of a mistake must remain distinct.
- In another owner position, Nxc3 is +752 cp versus +613 for the played rook
  move. Qxg7 in a different position is +166 cp. These are useful capture
  candidates, but an engine estimate alone does not establish that each is
  the most instructive tactical explanation.
- A second-sample Qxd4 is +150 cp, while the played Qxe7 is -750. The queen
  loss remains the principal mistake; the safe pawn capture is a possible
  secondary lesson, not a replacement for the queen-loss explanation.
- The new Petroff Nxe4 headline in the public ordinary-game control recovers
  the previously exchanged e-pawn. Likewise, the generated Catalan Qxc4
  returns a gambit pawn. Calling either a newly won loose pawn loses the
  game context, even though its standalone capture ledger is positive.
- A real king attack starting ...Rxg2+ receives a generic Hanging Pawn
  headline under the broad rule. The pawn is captured, but that does not
  explain the important attacking mechanism. The previously rejected queen
  liquidations remain inferior; visibility alone is not adequate primary
  selection.
- A public Nxe5 versus Nxe3 comparison is a 36-cp choice in the frozen
  searches, and a separate same-pawn bishop/knight capture choice has a
  neutral comparison. Their new generic-pawn outputs do not certify a new
  tactical mistake cause.

The broad source selection produced **2,361 passes, nine failed expectations
and 165 optional skips**. Some failures simply reflect the intended changed
admission policy, including constructed history-free cases; they are not nine
independently established false positives. The actual Petroff/Catalan recovery
noise and misleading king-attack headline are sufficient reasons not to ship
this draft. The patch and full trial reports are retained privately.

## A different genuine miss: saving the queen before collecting a fork

Five fresh public probes are recorded in
`fork-repair-recall-stockfish-18.json`, for the previously sampled Lichess
position tA2XR. Nf6+ is +244 cp. After ...Kh8, immediate Nxe4 is -661 because
...Nxb3+ takes the queen; Qf7 instead is +194. The queen move gets out of the
knight's attack while retaining the rook-fork pressure.

There is an important additional mechanism: after Qf7, ...gxf6 is met by
Rxh6#. The g7 pawn cannot capture the forking knight without abandoning the
h6 mating defence. The held capture and reply searches independently report
mate in one against Black and for White. The full best line also contains a
knight countercheck, so checking only a quiet king reply is insufficient.

This supports further work on quiet allied repairs and mating-backed fork
retention. It does **not** supply an all-defence root certificate, justify an
invented material bound, or make the current empty result a correct negative.
The classifier remains missing the useful first-move explanation. Merely
undoing the off-square queen-liability check would reinstate a false proof.

## Evidence and delivery boundary

Twenty final fresh Stockfish 18 depth-16 held searches cover eleven owner
capture roots, four different played choices and the five public fork probes.
They revisit existing development positions, not a new independent sample.
The private batch records legal root/line checks and completes all twenty.
Source replay performs no additional engine searches.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:
`root-pawn-{owner,disjoint,private,rare}-draft-20260916.json`,
`root-pawn-tests-draft-20260916.json`,
`root-pawn-admission-rejected-20260916.patch`,
`root-pawn-and-fork-probes-20260916.json` and
`root-pawn-and-fork-engine-20260916.json`.
Paid course and owner-game positions remain outside Git.

The source change was withdrawn with a scoped patch, leaving the existing
classifier and generated service intact. All 171 focused checks across eleven
files pass after withdrawal, with five optional checks skipped. No build, app restart, phone service
change or owner data mutation is part of this audit. The next recall changes
still need to distinguish present capture opportunities from trade recovery,
and to explain quiet repairs without returning to PV-funded tactical noise.
