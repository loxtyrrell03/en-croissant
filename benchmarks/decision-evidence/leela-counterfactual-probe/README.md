# Frozen Leela representations for classical diagnosis

This experiment tests whether a chess engine's learned representation adds
information to the Stockfish lines already available to Decision Evidence.
The frozen T1-10Lx256D representation comes from the final attention layer,
averaged across squares. The root arm uses that vector before a move. The
branch arm adds differences at two and four plies after the leading and
comparison moves. For mistakes the comparison is the actual played move.
For position character it is the second Stockfish candidate.
[Leela checkpoint](https://huggingface.co/LeelaChessZero/T1-10Lx256D)

All arms use identical saved Stockfish analyses. The controls include
evaluation gap or loss, a logistic model, a small neural network and a
boosted tree on legal line features. Two more controls add Leela's
win/draw/loss estimates or a fixed random projection of the same input
planes to the same logistic heads. Tactical and positional labels are
fitted independently. The lower of the two scores ranks mixed cases. It
has no joint probability interpretation. The branches start on the exact
legal boards from the saved frames. Features retain the known variation
history. No real game moves beyond the recorded decision enter the inputs.

## Fixed-budget results

The position models fit 259 reviewed positions and transfer to 104 other
games across eight classical events. The mistake models fit 225 usable
decisions and transfer to 48 decisions from 24 games across four other
events. One of the 226 training decisions lacked a complete legal pair.
Game, event family and color-normalized root splits were checked. The
references were previously reviewed for other methods and excluded from
fitting. A single reviewer supplied the labels. Game repetitions and
uncertain judgments are accounted for in the scoring.

Each entry lists reviewed positives, reviewed negatives and uncertain
nominations. Each row gives every method the same number of review slots
among cases where the cached classifier had no supported assessment for
that axis. Uncertain cases consume slots.

| Scope and axis | Slots | Legal-line tree | Leela root | Leela branches | Leela evaluation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Position, tactical | 20 | 18 / 1 / 1 | 17 / 1 / 2 | 18 / 0 / 2 | 17 / 0 / 3 |
| Position, positional | 17 | 17 / 0 / 0 | 17 / 0 / 0 | 16 / 0 / 1 | 17 / 0 / 0 |
| Position, mixed | 22 | 18 / 2 / 2 | 17 / 1 / 4 | 16 / 1 / 5 | 14 / 2 / 6 |
| Played mistake, tactical | 4 | 4 / 0 / 0 | 3 / 0 / 1 | 3 / 0 / 1 | 3 / 0 / 1 |
| Played mistake, positional | 4 | 4 / 0 / 0 | 2 / 0 / 2 | 2 / 0 / 2 | 2 / 0 / 2 |
| Played mistake, mixed | 4 | 1 / 0 / 3 | 1 / 0 / 3 | 1 / 0 / 3 | 1 / 0 / 3 |

Average precision on reviewed unresolved mixed positions rises from .867
with the tree to .882 with Leela's root vector. That metric excludes
uncertain labels. At 22 actual review slots, Leela nominates six reviewed
mixed positives that the tree misses and misses seven that the tree finds.
In a Bangladesh National Women's Championship example selected by Leela,
`Qa8` allows `Nxe5` and play on c5, while the `Qf4` queen trade leads to a
different rook ending and central pawn structure. In a Türkiye Cup
example selected by the tree, the pawn capture sequences behind `Qh5` and
the liquidation on f1 require calculation, while the advanced connected
central pawns are a separate strategic factor. These are reference
examples surfaced for review.

The prespecified screen requires two more positives than the strongest
control at the same budget, improvement in at least two events and no
additional reviewed negatives. No Leela arm passes. The reference
saturation for positional nominations, eight position events, four
mistake events and only four positive mixed mistake reviews limit
inferences. This study measures nominations. It adds zero verified
diagnoses and ships no model.

There were zero additional Stockfish nodes. Five Leela board evaluations
per decision took about 21 ms median on four CPU threads in the initial
run. Feature extraction and inference together took about 23 ms,
excluding model load and fitting. The fixed replay was repeated and
the rankings and selected cases reproduced.

## Reproduction

- Use Lc0 v0.32.1 and its `leela2onnx` command with the pinned weights
  file as input and an ONNX output path. Use the default float32 and opset 17.
  Both input and ONNX byte hashes are in [protocol.json](protocol.json).
  The same 112-plane encoding was checked against native Lc0's
  `valuehead` WDL output on the starting position, a Black-to-move
  middlegame and a position with a legal en-passant capture. Maximum
  absolute differences were below 0.5 per thousand.
  [Official converter release](https://github.com/LeelaChessZero/lc0/releases/tag/v0.32.1)
- Pass the v46 historical mistake replays named in the Maia README
  followed by the v49 primary replay to `--mistakes`. Pass the original
  Maia position training pair and its four transfer files to
  `--positions`. Repeat `--position-replay` for the 36-board
  independent input and incumbent worker output, followed by the
  35-board reserve input and incumbent worker output. These later
  two pairs come from the saved strategic-continuation experiment.
  The protocol pins their order and byte hashes.
  [Maia replays](../maia-branch-probe/README.md) |
  [Strategic continuation replays](../strategic-continuation-contrast/README.md)
- Run `scripts/benchmarks/decision-evidence-leela-probe.py` with the
  protocol, weight file, ONNX file and a new output path, followed by
  those replay arguments. The runner uses Python 3.13, ONNX 1.22,
  ONNX Runtime 1.24.2 and the existing Maia benchmark environment.
  Run `scripts/tests/decision-evidence-leela-probe.test.py` for board
  encoding and branch identity regressions. The [compact receipt](summary.json)
  includes scores and review counts by cohort and event.
