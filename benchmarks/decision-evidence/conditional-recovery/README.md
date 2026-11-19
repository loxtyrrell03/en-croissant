# Checking recovery after the engine changes its preferred reply

The previous comparison required Stockfish's first independent line
to agree with the main line. A different defence may rank first even
when the same practical reply is available and has already been
analysed. This experiment compares targeted searches against reusing
an exact reply from the existing MultiPV frame.

## Independent classical test

We froze 112 boards from 112 games before running Stockfish. The
sample contains 54 positions with a legal recapture contrast, 40
with a different capture contrast, and 18 ordinary controls. It
uses the recorded moves only for sampling. The engine's leading three
choices are evaluated from the position and its game history.
[Irish Championship](https://lichess.org/broadcast/irish-championship-2025-main-event/round-1/5BD62SDR) |
[Icelandic Open](https://lichess.org/broadcast/icelandic-open-2025/round-1/6YEfiELC) |
[Reykjavík Open](https://lichess.org/broadcast/reykjavik-open-2025/round-1/O7v0W1b7)

Fifteen alternatives across 14 boards allowed a common capture
with a potentially different immediate response. The controlled
arm independently searched after the weaker choice, forced that
reply after the better choice, and searched again from the position
reached by the capture. The two searches on the better branch used
one million nodes each, then four million nodes each as a stability
check. The weaker branch used one million nodes. Legal replay checks
the shared victim, the immediate resource, and the recovered piece
across the lines. The short arm used about 45 million total nodes,
and the deeper check used about 120 million more.

Both budgets confirm the same recovery in the Irish Championship.
After `...Kg8 Bxf7+`, Black can recapture with `...Kxf7`.
After `...Kh8 Bxf7`, Black has no equivalent recapture. The baseline
already explains that contrast using a normally searched reply.
All eleven tried third choices failed to add a diagnosis in the
independent sample. Earlier archive experiments found four
previously unclear positions by comparing the best move with the
third choice. The independent sample favours keeping the
existing search budget.

## Reusing cached evidence

The production change adds no engine requests. The independent
MultiPV frame can corroborate a particular reply even if it ranks
below another defence. The paired scores, legal response, captured
piece identity, and local material consequence must still agree.
The comparison tracks the original piece and destination, including
resources that remain legal after the piece relocates.
Each branch supplies its own SAN, including whether the capture
actually gives check.

The position report compares its two leading choices if both
independent reply frames are already supplied. The played-move report
continues to compare the recorded choice with the leader. On the
earlier deeper examples, the cached second reply restores the
Karlstad mistake explanation and the existing two frames now support
the separate Lorca position assessment. The 112 fresh worker reports
and all 1,050 valid archived reports agree with the baseline, apart
from the report version. This sample measures the yield of the targeted
searches. An independent set with eligible positives is still needed
to measure the production rule's recall. [Results](results.json)

## Reproduction

- [Protocol](protocol.json) gives the public sources, their hashes,
  sampling seed, classical time controls and exact engine.
- [Frozen positions](positions.json) includes the game histories and
  matched root and normally searched reply frames. [Exact targeted
  searches](controlled-searches.json) and the [reviewed evidence](reference.json)
  record the 15 explored alternatives.
- From the repository root, `python benchmarks/decision-evidence/conditional-recovery/review.py benchmarks/decision-evidence/conditional-recovery/controlled-searches.json`
  replays the reference comparisons. `collect_positions.py` resamples
  game-disjoint boards and regenerates root frames from the listed
  PGNs. `search_branches.py` takes an engine path, the stored
  controlled-search cases, and an output path to repeat the probes.
- Set `RECOVERY_OUTPUT` to a new file and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/conditional-recovery/vitest.config.mjs`.
  Set `RECOVERY_REVISION=70417a54` for the baseline or use the committed
  candidate for the revised worker.
