# Keep decision reports when a branch can draw

Decision Evidence compares several engine choices in a complete search frame.
The previous validator discarded the frame if any variation went beyond a
draw boundary. That could discard a good move, a legal defending move and
a usable played-move comparison at the same time. It also treated an
optional draw available to the winning side as if it always stopped play.

The search now keeps the legal prefix of an exact near-equal engine line
that reaches insufficient material. It separately checks the supplied
game history for repetition. When a very close engine score reaches a
position where a draw can be claimed, it bounds the displayed variation
there and revalidates the history and endpoint in the worker. At the
initial board, a claim-based line must supply the exact first move that
creates the repetition. The engine score is retained. The reported line
cannot be used to infer a payoff after its draw boundary.

A player favoured by a decisive engine score may decline their own
optional claim. A defender's available claim still blocks a claimed win.
The search also stops at an already completed automatic draw. This uses
the distinction between a claim under FIDE Article 9.2 and an automatic
draw under Article 9.6.
[FIDE Laws of Chess](https://handbook.fide.com/chapter/E012023)

The validator accepts insufficient-material truncation within 50
centipawns of equality and a history-based drawing prefix within ten.
A side is treated as favoured when the engine score is more than 50
centipawns in that side's favour or gives a mate for that side. These
gates are conservative. Some genuinely usable frames can still be
discarded when other branches cannot be retained without losing their
exact ranked choices.

## Matched replay

The archive contains 1,875 saved input requests, including replays of
the same game position. The independent cohort contains 104 positions
from different classical games across 11 event files. We froze the
cohort by game and colour-normalized position before the paired replay.
Positions were selected for past or currently claimable repetition
or low material. This enriched sample measures availability when a
draw boundary is plausible. It is not a general classifier accuracy
estimate.

Each held-out board used Stockfish 19 with one thread and 64 MB hash.
The collected root and optional restricted played comparison each used
2.4 million nodes. Reply searches used 1.4 million nodes. Both arms
received exactly the same data and passed accepted frames to the same
committed assessor. The transport replay counts supplied frames,
including saved replies from requests whose root frame would have failed
under the earlier live path.

| Cohort and frame | Supplied | Before | After |
| --- | ---: | ---: | ---: |
| Archived root | 1,875 | 1,866 | 1,873 |
| Archived played comparison | 1,067 | 1,059 | 1,065 |
| Archived reply | 2,943 | 2,933 | 2,939 |
| Held-out root | 104 | 68 | 88 |
| Held-out played comparison | 49 | 31 | 38 |
| Held-out reply | 153 | 123 | 144 |

Every previously accepted frame remains available on these inputs.
An independent python-chess replay checked all newly accepted frames
and every shortened continuation. It checked legal moves, draw
availability and which player could claim. There were 20 bounded lines
in the archive and 51 in the held-out cohort. For the held-out
requests the median time spent validating all supplied frames was about
5.8 ms before and 5.2 ms after in one run. The change adds no engine
searches or larger node budget. Previously discarded boards can now
continue to the usual reply checks.

## What changed in the report

Three held-out positions gained a supported tactical diagnosis. Two
reproduced their explanations with 4.8-million-node root searches and
2.8-million-node replies.

- In the Irish Championship, **65...g3+ 66.Kg1 Re1#** is a legal mate and
  **66.Kh3** avoids it. Other ranked moves have lines that end when the
  pieces are traded off. The extra engine moves after those terminal
  boards formerly suppressed all choices in the frame.
  [Exact game](https://lichess.org/broadcast/irish-championship-2025-main-event/round-6/ggPTlnXW/kqkXPsow)
- In a different Irish Championship ending, both accepted searches reach
  mate in nine for Black. The previous validator accepted the root but
  discarded both reply searches because the mating side could choose an
  optional draw along the way.
  [Exact game](https://lichess.org/broadcast/irish-championship-2025-main-event/round-3/iw15Ycod/dG2USNTq)
- In the Swedish team championship, **49.Rxf5+** receives a checked
  explanation about taking with tempo before **fxg5**. A deeper initial
  frame still needs the draw recovery. Its verdict remains unclear,
  because the deeper continuation does not support the same move-order
  explanation.
  [Exact game](https://lichess.org/broadcast/lag-dm-2026/round-3/sbfCtgNj/tryBtEJh)
- The archived comparison **54.Rd2+** versus **54.Re8+** now records the
  actual tactical mistake. **Rd2+** skewers the king on e2 and rook on
  h2. The played line reaches a claimable repetition. The paired search
  measures a 7.51-pawn difference. The earlier validator discarded this
  entire comparison while preserving the position's skewer lesson.
  [Exact game](https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-7/Cd33Pm6w/k8M4L4fz)

No new mixed verdict was found in this replay. It measures access to
evidence and shows specific resulting diagnoses. It does not establish
the recall of the existing classifier across other positions.

## Reproduction

Use Python with python-chess and the recorded Stockfish 19 binary
(SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`).
Reuse the scored archive at `allowed-route-mistakes/inputs.json` under
the local classifier research directory. The [results](results.json)
record the SHA-256 of each input and the classical event files.

1. Run `sample.py freeze HELDOUT ARCHIVE PGNS...` with the local event
   files in the recorded order. The selection is deterministic.
2. Run `sample.py score HELDOUT_SCORED HELDOUT STOCKFISH
   benchmarks/decision-evidence/defence-after-attack`. For the deeper run
   select the three held-out tactical additions in `results.json`, in
   their original order, and append `4800000 2800000`.
3. Set `DRAW_FRAME_INPUT` to the scored array and `DRAW_FRAME_OUTPUT`
   to a fresh output path. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/draw-aware-search/vite.config.mjs`.
   Use these output names in the replay directory
   `archive-replay.json`, `heldout-replay.json` and `deeper-replay.json`.
   The worker in this benchmark is pinned at `e64555d2`. The changed
   validation is the production pure function.
4. Run `verify.py ARCHIVE REPLAY_DIRECTORY OUTPUT`. In that directory
   also keep the held-out input, two scored split files and the sample
   manifest using the names in `verify.py`.
5. From the repository root, use the existing test runner for
   `decisionEvidence.test.ts`, `decisionSearchFrame.test.ts` and
   `decisionSearch.test.ts`. The source browser check
   `verify-panel.mjs PLAYWRIGHT_MODULE CHROME` clicks the real analysis
   panel, exercises the search and worker with recorded engine responses,
   and uses keyboard expansion at three widths.
