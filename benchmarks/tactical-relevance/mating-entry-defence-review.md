# Capturable mating entries and existing forced-mate outcomes

Adapter **131 / live pipeline 136** improves the explanation of already-found
mates. It does not add live-board themes or claim a new general recall gain.
The motivating owner position was identified in the adapter-130 whole-game
review: developing the knight guards the rook's entry square, so the same rook
check can be captured. The better position is still materially worse.

## What the new evidence establishes

The comparison requires a legal capture of the exact initiating piece, the
existing 90-cp immediate exchange floor after accounting for the entry capture,
and a complete finite no-mate strategy. For mating distances two through four,
every legal attacking move is covered, including quiet moves and promotions;
the defender must have a legal answer at every defensive turn. A shared 32,768
visit limit returns unknown when exhausted. The final attacking ply uses the
existing check nomination optimisation; independent validators instead replay
every legal move on that ply. No engine or worker deadline is increased.

This proves avoidance of **this entry's claimed mate window**, not a winning or
drawn position, retained material, shortest mate, or absence of longer/different
attacks. The displayed comparison explicitly states that limitation. If the
better line independently forces mate by another route, that outcome takes
precedence: even a longer forced mate remains existing danger, not newly caused
mate. A failed mate search is never used as positive defensive evidence.

## Owner-game results and chess judgement

Exact-input replays retain all 512 contexts from the same ten owner games:
217 original, 122 disjoint, 81 third-sample and 92 August contexts. There are no
new whole-game engine inputs or independent games in this milestone.

- Three contexts gain concrete comparisons: two queen-entry captures and the
  motivating knight capture of a rook. These are three specific mating-route
  explanations, not three saved games. Both queen-entry alternatives remain
  heavily losing in the fresh full-position estimates.
- Four contexts now say the forced-mate outcome persists after the better
  move. Complete alternative mating strategies, including one within six
  moves, were independently checked. This also prevents the new finite defence
  rule from incorrectly blaming a move for creating an already-forced mate.
- Two existing-danger contexts change wording only. The original 217 and
  disjoint 122 results are unchanged apart from versions; nine full rows change
  in the other samples. All live headlines and board annotations are unchanged.

These are adjacent/repeated stages of combinations, not nine independent new
tactics or an accuracy score. The broader quiet-preparation, nomination,
primary-specificity and material-compensation gaps remain open.

## Contrary evidence and independent verification

There are **158 fresh Stockfish searches**: 122 positive-root/first-answer
decisions, twelve poisoned-capture controls and 24 changed owner comparisons.
The public receipt contains only ninety constructed decisions; owner boards
and complete private receipts stay outside Git. Tests match every public
receipt to its exact current board and selected move, not merely its existence.

Three selected finite-horizon answers have adverse full-position scores: one
constructed f4 answer is -1 cp, and two owner f4 answers are -69/-56 cp. They
avoid the specified short mate but needlessly surrender material. They are
**not** recommended material-retention plans and are not displayed as the user's
continuation. The actual proposed owner Nxe2 capture scores +425 cp for White;
the same rook entry after Nc3 scores -444 cp for Black. None of these engine
estimates is an exact outcome certificate.

Both colours of an immediate poisoned rook capture are rejected, as are both
colours of a pawn capture permitting a quiet mating setup. The latter entry is
not itself forced mate against every defence; it specifically refutes the
proposed capture. Avoiding the shorter window still passes, intentionally
demonstrating why the result cannot mean general king safety. Initial controls
were corrected when legal replay exposed a blocked rook path and an exchange
loss that would bypass the intended mate test.

The new python-chess validator independently checks exported strategies,
including every final legal attacking move. The constructed positive graphs
each contain 1,423 nodes and 16,816 final moves; the motivating owner graph has
2,010 nodes and 26,280 final moves. Both queen-entry graphs have one node,
covering 29/31 final moves. Four different retained mate strategies also pass
the existing independent mating-tree validator. These are graph sizes, not
independent positions or engine search counts. Canonical legal en-passant FEN
comparison avoids a representational mismatch between the two chess libraries.

Private evidence under `Documents/OnCrescent Tactical Benchmarks/`:

- `mate-entry-defence-strategies-20260916.json`
- `mate-entry-owner-cause-evidence-20260916.json`
- `mate-entry-defence-engine-20260916.json`
- `mate-entry-defence-controls-engine-20260916.json`
- `mate-entry-owner-cause-engine-20260916.json`
- the four `chesscom-*-adapter131-final.json` exact-input replays.

## Integration, regression and delivery scope

The broad source run passes 2,500 tests with 197 optional skips across 167 files;
the subsequently added ninety-receipt regression also passes. The final focused
cause/nature/priority selection passes 133 tests with three optional skips. TypeScript and
six-file scoped lint pass. The generated review service passes eleven tests
with one optional engine case skipped, including card/deck/reload preservation
of the new comparison. Its initial fixture used the wrong cloud-score sign;
the fixture now correctly uses White-relative scores, without changing review
selection thresholds.

The frontend and 43-module shared-review builds pass. The worker is
`liveTactics.worker-CEJiJO1k.js`, SHA-256
`d0062685dac0a459b7ec449ed79f3cc479d8a09020cf0d5625735ee5bb7ca882`.
It differs from adapter 130 by exactly the version-string byte: the new
mistake-comparison code is not part of the live classifier worker. A focused
fourteen-input compiled-controller group passes; the 246 private/20 rare full
replays and cold-HTTP suite were not freshly rerun for this change. Prior
stability results are not new accuracy evidence.

Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
No owner app or phone service was started/restarted, no browser automation ran,
and owner data/settings are unchanged. Native interaction and load-sensitive
startup remain unverified. This milestone does not complete the recall goal.

## Next recall boundary: a verified move excluded before classification

A post-source diagnostic reuses the already-reviewed quiet knight discovery/pin
from the August sample and its frozen depth-16 held-move search. The held move
scores +74 cp versus +139 for the principal move, within the existing 80-cp
alternative tolerance; it is nevertheless absent from the three actual engine
candidates. The current classifier recognises Pin and Discovered Attack from
the root move alone and from its held engine continuation.

The diagnostic confirms that appending this verified line as a fourth supplied
candidate still discards it: `buildLiveTacticalScan` slices the list to three
before classification. Substituting it into an admitted slot recognises the
themes. That substitution is a diagnostic constructed list, **not** a fresh
engine rank, new score, production fix, or justification to borrow a later
line's score. The earlier played continuation's generic Quiet Preparation
headline also remains a primary-specificity question.

Private receipt `adapter131-candidate-boundary-audit-20260916.json` preserves the
original, appended, substituted and root-only outputs. The diagnostic passes
after correcting its initial use of the mistake-review wrapper instead of the
position classifier. No new engine searches or production edits are involved.
The next useful recall work must nominate and independently assess relevant
moves outside the first three engine choices without claiming that a locally
proved gain guarantees a sound full position or increasing scan latency
unboundedly. Merely weakening theme proofs would not fix this missing input.
