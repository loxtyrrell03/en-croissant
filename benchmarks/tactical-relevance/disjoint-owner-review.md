# A second whole-game owner audit

Adapter **116** / live pipeline **121** is unchanged during this audit.
The sampler now accepts explicitly excluded game IDs from an earlier frozen
sample. It excludes those IDs before sorting by end time and never selects on
engine score, result or classifier success. The CLI can read the earlier private
sample from the same monthly archive; exclusions are carried into the new
receipt. Six sampler checks and scoped lint pass.

The next three games contain **122 pre-move positions**. They share no game IDs
with the earlier three games but include eight exact-FEN opening overlaps.
Initial chess notes preceded engine/classifier output. **119 distinct fresh
depth-16 MultiPV searches**, then **fifteen held-move searches**, inspect all roots
and selected decisions. Private games, annotations and detailed receipts remain
outside Git under `Documents/OnCrescent Tactical Benchmarks/`.

## What the comparison establishes

The reviewed pawn fork, two large queen-for-minor losses, loose knight and
back-rank mating sequence receive concrete explanations. Exchange compensation
is retained, actual best moves are not called missed choices, and the earlier
material-or-mate attack is not upgraded to a forced mate from the later actual
game continuation. An initially interesting knight offer is materially worse
than the quiet pawn break in the held engine searches; it is not a recovered
sound-sacrifice lesson.

Two older pawn grabs remain empty. The engine does not establish either as a
missed winning combination: they are modestly inferior to the selected
alternatives. This does not refute their local material gain or solve the
older-pawn coverage question. One also falls outside the baseline top three
candidates, which is a separate nomination limit. The first sample's unresolved
checking pawn capture remains open.

The audit also finds a concrete **value defect, unfixed at this milestone**: an ordinary later fork
can inherit earlier/future PV material totals, while the same reached board
with a different suffix produces a different value. The legacy proposal is
checked for fork existence but not always replaced with a position-local gain.
The follow-up should retain the genuine fork, correct its value, and recheck
primary selection; deleting the theme would worsen the current recall goal.

The subsequent [local fork-value review](fork-local-value-review.md) records
that correction, compensation-aware continuation recall, contrary witnesses
and still-missing quiet fork preparations. This document preserves the original
adapter-116 findings rather than treating the later changes as baseline results.

There are 21 immediate-root outputs, one continuation-only output and 100
empty outputs. These are **coverage counts, not accuracy counts**. The selected
judgements do not certify every board or every supplied theme. All 122 scans
from the actual packaged worker match source results through the production
controller; this is runtime parity, not independent chess adjudication.

## Receipts and delivery

Private evidence: `chesscom-recall-disjoint-20260916.json`,
`chesscom-disjoint-{initial-judgement,reviewed}-20260916.md`,
`chesscom-disjoint-adapter116-baseline.json`,
`chesscom-disjoint-decision-engine-20260916.json`, and
`chesscom-disjoint-adapter116-worker.json`.

This milestone changes only benchmark selection/documentation. The preceding
classifier source `346be881` is already packaged; see
`docs/TACTICAL_DESKTOP_DELIVERY.md`. No app was started/restarted, no phone
runtime was deployed, and no owner games/settings were changed. Broader recall,
the newly identified fork-value defect, native responsiveness and representative
independent accuracy remain open.
