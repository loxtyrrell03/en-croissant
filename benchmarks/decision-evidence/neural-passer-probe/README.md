# Can a neural network identify which passers matter?

This experiment asks whether a frozen Leela chess network helps identify a
specific strategic consequence in classical games. Its localized readout
looks at the passed pawn, its next square, and the enemy king immediately
after a candidate move. A regularized classifier combines those activations
with shallow Stockfish lines and ordinary board features. This tests the
hypothesis that averaging an entire board can hide information about one
piece. The comparison includes pooled Leela features, Leela's evaluation,
the raw pieces on the same squares, and models that use Stockfish and board
features alone. Chess concept probes motivated this design.
[AlphaZero concept probes](https://pmc.ncbi.nlm.nih.gov/articles/PMC9704706/) ·
[Leela checkpoint](https://huggingface.co/LeelaChessZero/T1-10Lx256D)

## Reference and split

The reference follows the exact pawn through ten legal plies. In each of
two plausible replies from a separate deeper search and the corresponding
paired root line, a positive needs the pawn to make a non-capturing advance
and survive. An early capture counts against the target. Incomplete lines,
divergent outcomes and insufficient reply coverage remain uncertain. A
stationary passer can still restrict pieces, and an advance can be tactical.
The target only tests this concrete consequence. It supplies no direct
label for the position, the move or the player's mistake.

The models reuse public classical frames from the
[deeper-search experiment](../neural-deep-witness/README.md). Games, event
families and colour-normalized root and candidate boards stay disjoint.
First run used 1,244 training assets across 303 games, with 39 positives,
380 negatives and 825 uncertain outcomes. Models fit only the 419 definite
labels. The training frames have varying deep search budgets. Ordinary
transfer has 110 assets in 37 games across eight families. The reserve
contains 166 assets in 54 games across ten families and favours
broadcaster-annotated errors. These cohorts have been used for previous
research. This target and model were evaluated on them once, without tuning
on their results. Neither set contained a same-pawn pair with opposite
definite labels, so within-position comparison remains untested.

## Results

Each cell reports target-positive nominations, scoped negatives and
uncertain positions at the same budget. The shortlist includes one quarter
of the assets in each event, rounded up. Average precision excludes
uncertain cases. The full receipt records the remaining controls,
shortlists, and Brier scores.

| Ranking | Ordinary, 30 slots | Error reserve, 46 slots | Ordinary AP | Reserve AP |
| --- | ---: | ---: | ---: | ---: |
| Early Stockfish advance count | 4 / 4 / 22 | 4 / 7 / 35 | .460 | .424 |
| Static logistic | 5 / 5 / 20 | 3 / 9 / 34 | .602 | .391 |
| Shallow-line logistic | 4 / 7 / 19 | 3 / 8 / 35 | .713 | .661 |
| Shallow-line tree | 4 / 6 / 20 | 2 / 8 / 36 | .650 | .501 |
| Shallow lines plus pooled Leela | 5 / 8 / 17 | 3 / 5 / 38 | .717 | .640 |
| Shallow lines plus localized Leela | 4 / 6 / 20 | 3 / 8 / 35 | .760 | .673 |

Localized Leela raises average precision over the same logistic model
without the network by .047 and .012. Its Brier score is worse in both
sets. The fixed shortlist recovers fewer reference positives than the
strongest simple control in each set. There are only seven definitive
positives in the ordinary sample and six in reserve. The model adds no
Stockfish nodes during ranking and uses about 3.7 ms per candidate board
with batched CPU inference and feature preparation. This excludes model
load, fitting and the shared shallow Stockfish analysis.

## Stronger recheck

At 3.6 million nodes per query, the separate paired and reply searches
retain seven of the thirteen original positives, reverse two, and leave
four uncertain. The ordinary shortlist from the localized model retains
three positives, the same as both static and shallow-line logistic. In
the reserve it retains one compared with two for the early advance count.
This recheck assesses the original positives only. It cannot estimate
revised precision or recall across the whole cohort.

- In the ordinary Czech Open rook ending, the localized model alone among
  the two shallow-line logistic models shortlists the f3 passer after
  `53...Kc6`. The stronger search sees `54.Rd1 Rb8 55.f4` in one line and
  `54.Rd8 Rb5+ 55.Kf6 Rb4` in another. The second line stops short of
  confirming the advance. [Czech Open round](https://lichess.org/broadcast/czech-open-2026-a/round/rIbHX8Zn)
- In a Mongolian Championship game, Black's g5 passer survives and
  advances to g3 after both `...Ng6` and `...Re8` in the stronger search.
  The shallow-line logistic and localized model both shortlist it.
  [Mongolian Championship game](https://lichess.org/broadcast/mongolian-national-chess-championship-2026-open/round-10/VfGrQ4e5/GS94bBME)

The model stays offline. The search target proved sensitive to depth, and
the fixed shortlist showed no gain. A stronger test of learned strategic
reasoning needs same-position alternatives with manually reviewed,
contrasting outcomes. The few positive assets here cannot answer whether
a learned model would improve mixed-position coverage on new games.

## Reproduce

From the repository root, use Python with python-chess, NumPy,
scikit-learn, onnx and onnxruntime. Convert the retained Leela weights
with Lc0 v0.32.1 `leela2onnx` as in the
[previous Leela experiment](../leela-counterfactual-probe/README.md).
The network and frame hashes are in [protocol.json](protocol.json).

1. Run `experiment.py FRAME_DIRECTORY NETWORK_ONNX OUTPUT` from the
   repository root, passing the full path to this script. The retained
   `classifier-rework/neural-search-yield` folder contains `train.jsonl`,
   `test.jsonl` and `reserve.jsonl`. The two runs reproduced all scores
   and shortlist memberships. Timings vary.
2. Run `audit.py FRAME_DIRECTORY STOCKFISH OUTPUT` from the repository
   root for the deeper check. The receipt has the exact search lines and
   Stockfish binary hash. Run `test_experiment.py` for legal asset tracking
   and reference and split checks.

[Benchmark receipt](results.json) · [Stronger Stockfish searches](audit.json)
