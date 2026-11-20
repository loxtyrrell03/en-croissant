# Three-scope classical transfer

The 72-board sample covers 15 classical event groups. It was selected
by game, rating band and ply window before either classifier ran. One
engine-assisted reviewer sealed three labels per board in `df328093`
with the compared continuations and uncertainty. The review and scoring
distinguish the character of the board, the leading app-budget move and
the actual played move. The original position and candidate proxies
use motifs attached to that exact root move. The original supports a
separate mistake classification and did not have both position axes.

All arms use the same app-budget Stockfish frames.

| Scope and axis | Reference positives / negatives / unresolved | Original true / false positives | v47 true / false positives | v57 true / false positives |
| --- | ---: | ---: | ---: | ---: |
| Position, tactical | 29 / 1 / 42 | 6 / 0 | 9 / 0 | 9 / 0 |
| Position, positional | 59 / 1 / 12 | — | 13 / 0 | 13 / 0 |
| Position, mixed | 17 / 2 / 53 | — | 0 / 0 | 0 / 0 |
| Exact move, tactical | 19 / 4 / 49 | 6 / 0 | 8 / 0 | 8 / 0 |
| Exact move, positional | 54 / 3 / 15 | — | 7 / 2 | 7 / 0 |
| Exact move, mixed | 7 / 7 / 58 | — | 0 / 2 | 0 / 0 |
| Played mistake, tactical | 3 / 52 / 17 | 1 / 1 | 1 / 0 | 1 / 0 |
| Played mistake, positional | 10 / 52 / 10 | 1 / 1 | 2 / 0 | 2 / 0 |
| Played mistake, mixed | 0 / 52 / 20 | — | 0 / 0 | 0 / 0 |

Of the 17 positive mixed positions, v57 supports neither axis on 11,
the positional axis alone on four, and the tactical axis alone on two.
The corresponding exact-move counts are four, one and two out of seven.
There are no positive mixed mistakes in this sample.

The apparent tactical precision is based on one known position
negative and four exact-move negatives. The v57 tactical recall interval
from resampling event groups is 16–44% for positions and 21–61% for
exact moves. The observations are conditional on this single reviewed
reference. Unknown labels and calls on them are outside binary accuracy.
The seven reviewed motif checks give two correctly identified loose
pieces, one missed mating threat and no calls on four checked motif
negatives in every arm. This audit gives no per-motif estimate outside
those checks. The full results include counts, category abstentions,
rating and ply breakdowns, and event-resampled intervals.
[Full results](classical-results.json) · [Sealed reference](classical-reference.json)

The two v47 false mixed move calls illustrate the difference between
having a board feature and explaining a move. One labels the g2 passed
pawn after Qxg6+ even though the specific choice depends on the king
attack. The other cites the bishop pair after Qxh3, which simply takes
the undefended bishop. V57 keeps tactical support on both choices and
reserves positional judgment.

## Wider and deeper Stockfish frames

V57 was also given the separately captured 5.4M-node four-choice
root and 3.2M-node replies. The search changed the leader on 12 boards.
There was no mixed recovery. Positional position recall fell from 13
to 9 of 59. Even on the 60 boards with the same leading move, that
count fell from 12 to 8 of 48. Tactical position recall stayed at
9 of 29 across the complete set. The exact-candidate comparison omits
one candidate that leaves the searchable list. Stable root identity
does not guarantee a stable explanation when the reply lines change.
These are the same deeper frames used in the review, so this is a
diagnostic comparison of inputs to one classifier.
[Depth results](classical-depth-results.json)

The cached classifier took 64 ms median for all three v57 assessments
together, versus 63 ms for v47 on this machine. The original root
scan took 30 ms median and the separate mistake call took less than
1 ms median on this sample, where many played moves were near-best.
Engine capture used 279 queries for the app-budget run and 287 for
the deeper run. Last complete frames represented 448 million and
1.04 billion nodes, respectively, across all 72 games. The optional
application searches are outside the cache replay.
[Engine cost and frame hashes](classical-frame-receipt.json)

## Exact checks of representative misses

These follow-up searches are diagnostic and use the already opened
test cases. Each compares two exact moves from the same reached
board. Results repeat at 4.8M and 8M nodes.

- After `37.Bg5 f6`, the pawn advance opens the other bishop's
  diagonal. `38.Bg8+ Kh8 39.Bc4+` scores 100 and 102 centipawns
  above immediately retreating with `38.Bf4`. The normal worker
  left both scopes unclear. The root move attacks a rook and its
  tactical rationale appears after a noncapturing reply that
  looks like a defence. [Game](https://lichess.org/broadcast/2026-fall-nyc-chess-norms/round-8/hamEFh8f/jQ7rHyrs)
- After `45...Bf2 46.Rh5`, `46...Bxe3 47.Kxe3 Rxb6`
  contains the original b6 passer. Taking b6 immediately allows
  Bxf2. Removing the bishop first performs better by 573 and 589
  centipawns for Black. This combines a quiet defence, an exact
  defender-removal sequence and a strategic goal.
  [Game](https://lichess.org/broadcast/interclubes-apertura-102-club-de-ajedrez-de-chile-2026/ronda-4/mmBAP7Od/JUImU3OB)
- `20.Bh4 Qh7` leaves White's minor pieces aligned. `21.Nxf6`
  gives up the bishop on h4, while `21.Qc1` gives up the knight
  on h5. After `20.Qc1 Qh7`, the separate `21.Nxf6 Bxf6
  22.Bxf6 Nxf6` line preserves the material balance instead.
  Both searches corroborate the exact contrast, while v57 left
  the played mistake unclear.
  [Game](https://lichess.org/broadcast/interclubes-apertura-102-club-de-ajedrez-de-chile-2026/ronda-2/qJsVhpBL/FjsVrbkO)
- In the contrary `19.g4 Qg5` case, Black's reply is tactically
  punishable. `20.Bxg6` and `20.gxh5` both work in the matched
  tests and differ by only 16 centipawns. The exact order is
  unproved despite different exchanges. Likewise, showing that a
  king can take the rook after it captures a pawn only proves a
  local consequence. The passed-pawn control still leaves both
  root choices losing. A tactic's presence and the necessity of a
  particular order need different evidence.

The current conditional capture verifier tests a tempting capture
of the piece just moved. These cases motivate testing a defender's
legal counterattack or interposition and keeping the result attached
to its own scope. The missed positional observations also need
support that survives different viable replans. A positional assessment
based solely on one repeated continuation is sensitive to engine
preference changes. The latest benchmark leaves both design changes
for validation on new cases.
[Exact counterfactuals](classical-counterfactuals.json)

## Reproduction

Use the frozen app-budget capture and reference hashes from the
[audit](README.md). Run `classical_score.py APP_FRAMES REFERENCE
REPLAY_DIR` to prepare label-free inputs.

1. Replay `classical-legacy-input.json` with the
   [original worker config](../cross-scope-audit/archive.config.mjs),
   `DECISION_SCORE_ARM=original` and `DECISION_SCORE_ROOT_MOTIFS=1`.
   Point `DECISION_BASELINE_CAUSAL` to the archived, hash-checked
   original causal source. Save `classical-original.json` as the
   output. The [archive instructions](../cross-scope-audit/README.md)
   describe the replay variables and source restoration.
2. Run `replay.config.mjs` in archive mode with
   `classical-replay-input.json` and revisions `ae4bf1fc` and
   `27580772`. Save `classical-v47.json` and `classical-v57.json`.
   Rerun the scorer with `--score RESULTS`.
3. Run `classical-depth.py APP_FRAMES DEEP_FRAMES REFERENCE REPLAY_DIR`.
   Replay `classical-deeper-input.json` with `27580772` and save
   `classical-v57-deeper.json`. Repeat the command with
   `--score DEPTH_RESULTS` to produce the depth comparison.
4. Run `classical-counterfactuals.py SAMPLE REFERENCE STOCKFISH OUTPUT`
   and repeat with a different output and `--nodes 8000000`.
