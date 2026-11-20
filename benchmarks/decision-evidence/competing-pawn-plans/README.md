# Pawn breaks and competing plans

Decision Evidence already recognises some shared central pawn breaks. This
experiment looks at other structural decisions. A move can challenge a pawn
on the wing, or two viable moves can challenge the same pawn from different
files. A legal pawn exchange establishes a board fact. Added evidence is
needed to say whether that fact explains a move.

The comparison replays every proposed line. It follows the two original
pawns from contact to exchange and checks whether that exchange frees an
originally occupied pawn file at a materially stable checkpoint. It tests
two different questions.

- **Position character.** Two distinct, competitively scored choices lead
  to the same break in different move orders, or use different breaks to
  change different files. The stricter arm asks for actual rook use by
  the player in both lines.
- **Move justification.** The root choice itself creates the pawn contact.
  The root and a separate reply search show the same file without an
  allied pawn and a rook using it in each. Either a quiet rook move
  reaches the file with access into opposing territory, or the later
  rook capture takes the original pawn left by the exchange on that file.
  The latter is counted separately from the opening exchange.

The first version required immediate recaptures. The revision permits a
recapture after up to three intervening non-captures, provided the capturing
piece stays on the exact square. It allows the later rook capture described
above. The two requirements are tested on the same engine frames.

## Samples and results

The 40 development positions use four events. The first reserve contains
126 positions from nine different classical events. We revised the rule
after reviewing it, then ran it once on a second reserve of 92 positions
from eight separate events. One position per game was selected. The freeze
excludes matching game prefixes and colour-normalized boards from the
archive and earlier splits. The sampling enriches for contact moves found
in the recorded games and includes both recorded exchanges and contact
without a local settled exchange. It does not assume the recorded move
is best and does not give that move to the position classifier.

All arms received three exact Stockfish 19 root choices from a 1.2-million-node
search and a 1.8-million-node independent probe after the best choice.
An independently repeated search at 2.8 million and 3.6 million nodes
checked the reached mechanism. The first and second reserves retained the
same leading root on 93/126 and 68/92 boards. The deeper check uses
python-chess and keeps visible strategic changes separate from the
scope-specific rook-use requirement. Manual readback checks the changed
cases and named examples. These are enriched, single-reviewer samples.
A different engine continuation can invalidate a corroboration without
establishing that the earlier line was illegal or its board fact false.

| Trial at the same initial budget | First reserve, potential new explanations | Second reserve, potential new explanations |
| --- | ---: | ---: |
| Broad structural position comparison | 3 | 1 |
| Both viable choices show rook use | 1 | 0 |
| Both viable choices show rook use, with delayed recaptures | 1 | 0 |
| Exact leading move, consecutive exchange, repeated rook use | 2 | 2 |
| Exact leading move, delayed exchange, repeated rook use | 3 | 2 |
| Revised leading-move nominations also verified in both deeper lines | 2 | 0 |

The last row has the strongest repeat requirement. There were three scoped
deeper positives in the first reserve and two in the second reserve among
boards with the same leading move. The first version recovered one of the
first three. The revised version recovered two. Both recovered zero of the
second two. Three revised nominations fell outside this scope at the
deeper budget. In one case the deeper leading line also shows rook use
but the independent reply differs. In another, the structure and rook move
repeat but the rook's range is blocked sooner, so the case does not meet
the preset access criterion. In the third, the deeper searches choose a
queen recapture. These are scoped non-confirmations. They are not a
general positional false-positive rate.

All five experimental arms returned zero potential additions across
40 development frames and 71 earlier manually reviewed positions.
The two position cohorts contained three tactical positions each under
the incumbent, and the trial added no mixed diagnosis. There is limited
evidence for introducing this as a new verdict. It remains experimental.

## Exact decisions

- **Irish Championship, 29.h3.** The lower-budget lines play
  `29.h3 gxh3 30.Rxh3`. Deeper Stockfish inserts `30.Ne2 c5` before
  `31.Rxh3`. In both searches the black pawn stays on h3 until the rook
  takes it. White then plays `Rh1` on the pawn-free h-file. A rule requiring
  an immediate recapture misses the deeper continuation.
- **European Club Cup, 27.b4.** After `27.b4 cxb4 28.cxb4 axb4
  29.Ra7 Nc5 30.Rxb4`, the original rook on b5 takes the pawn from a5.
  Both engine budgets corroborate that use of the b-file. The initial
  consecutive-only trial ignored captures as possible evidence of later
  rook use, so it missed this example.
- **Serbian Women's Championship, 13...f5 or 13...Rfe8.** Both engine
  budgets show `...f5 exf5 ...Qxf5` opening the f-file for Black, or
  `...Rfe8` followed by `...d5 exd5 ...Qxd5` opening the d-file. The
  latter continuation holds even when the deeper search inserts further
  piece moves. This compares two meaningful ways of confronting White's
  e4 pawn. It does not isolate the score contribution of either file.
  [Exact broadcast position](https://lichess.org/broadcast/20-pojedinacno-prvenstvo-srbije-za-sahistkinje/round-3/jbyXD7GB/upziaFz5)
- **Poland, 25...d5.** At the lower budget, `26.exd5 Rxd5 27.Na3 Rd2`
  uses the d-file immediately. The deeper searches both prefer
  `26...Qxd5` and do not show that rook entry over the measured window.
  This is a concrete limit on projecting the initial line into a
  general reason for the move.

The five local replays together take about 1.6 ms median per case
after engine analysis. They add no engine queries to the proposed app
path. This experiment does not change the live worker or the UI.

## Reproduction

The [results](results.json) preserve the source PGN hashes, split hashes,
scope counts and exact UCI lines for candidate additions. Reuse the
local PGNs identified by filename and hash. No course or private
game export is needed. Use python-chess and Stockfish 19 with SHA-256
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.

1. In order, freeze `development`, `reserved` and `replication` with
   `gather_plans.py freeze ARCHIVE OUT MANIFEST PHASE PGNS...`.
   Use the retained `allowed-route-mistakes/inputs.json` archive as
   `ARCHIVE`, use per-source per-type limits of 5, 7 and 6 respectively
   with `--each`, and use `--exclude` with the preceding splits' selected case files. Give `PHASE` the label
   `development`, `reserved` or `replication`.
2. Run `gather_plans.py engine INPUT SCORED STOCKFISH
   benchmarks/decision-evidence/defence-after-attack` on each split.
   Run both reserves again with `--root 2800000 --reply 3600000` and pass
   `DEEPER SCORED REFERENCE` to `reference.py`.
3. Set `BREAK_PLAN_INPUT` to each scored split and `BREAK_PLAN_OUTPUT`
   to a fresh output filename. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/competing-pawn-plans/vite.config.mjs`.
   The replay pins the baseline worker at `561e1bdc` and runs each trial
   in isolation. For the historical replay, concatenate the two
   `holdout.json` and `reserve.json` arrays from the
   [earlier benchmark](../strategic-continuation-contrast/README.md).
4. Run `score.py RAW_OUTPUT_DIRECTORY OUTPUT`. The scorer expects the
   named outputs in its `main` function. With the environment variables
   unset, the Vitest command runs the four exact regression frames only.
