# Can a board-aware network recover missed forks?

The earlier neural models read engineered line features. This experiment
adds a spatial encoder that reads pieces on their squares, the exact move
and the legal replies after it. The same architecture is trained from
scratch and with pretraining. Pretraining uses 21,305 pairs from 10,800
Lichess puzzle games. Each pair gives the published solution move and a
legal alternative from the same board, matched where possible on mover
type, check, capture and fork geometry. The objective learns solution
preference and can include alternative moves of equivalent value.
[Lichess puzzle database](https://database.lichess.org/#puzzles)

Both networks then learn an exact fork target from 1,300 known engine
labels, including 188 same-board pairs with one positive and one negative
candidate. The 13,113-parameter network uses a shared two-layer spatial
encoder, applies it to the original move and up to four plies of each
defensive line, and pools features at the source and destination squares
alongside board-wide features. Its two lines also contribute the same
quick tactical summaries used in the controls. The networks use three
fixed seeds and early stopping on engine-labelled validation cases.
Every model has the same two replies from one 6,000-node Stockfish
search. No private game is used for fitting.

The teacher has a narrow positive target. Two separately ranked replies
from an independent 120,000-node search must let the fork piece collect an
original target by ply five, retain material and leave a favourable
evaluation. The reviewed references also accept genuine forks where a
defence gives up different material or where collection arrives later.

## Results

Only previously reviewed moves with legal two-non-pawn fork geometry enter
this experiment. The original classical cohort has 88 games, including 24
private classical games. The reserve has 30 games from three separate
public events. The 40-case independent puzzle audit contributes 20 eligible
moves and excludes 20 without that geometry. Source games and
colour-normalised root positions stay in one partition. Earlier
experiments used these review cohorts. This is exploratory transfer of a
new frozen model, with the 424-candidate engine-labelled puzzle test
separate from fitting and early stopping.

Each cell shows reviewed forks, reviewed negatives and uncertain cases
among moves shortlisted after the incumbent verifier abstained. An
uncertain case still occupies a slot. These are retrieval results for
further analysis.

| Ranking | Classical, 20 slots | Classical reserve, 6 slots | Reviewed puzzles, 2 slots |
| --- | ---: | ---: | ---: |
| Quick Stockfish evaluation | 3 / 6 / 11 | 1 / 1 / 4 | 1 / 1 / 0 |
| Quick legal payoff cue | 2 / 5 / 13 | 1 / 4 / 1 | 2 / 0 / 0 |
| Reply logistic regression | 3 / 6 / 11 | 1 / 3 / 2 | 1 / 0 / 1 |
| Handcrafted reply network | 2 / 10 / 8 | — | — |
| Spatial network from scratch | 2 / 10 / 8 | 1 / 2 / 3 | 1 / 0 / 1 |
| Pretrained spatial network | 1 / 9 / 10 | 1 / 3 / 2 | 2 / 0 / 0 |

The recorded incumbent found four of seven reviewed forks in the original
classical set and five of six in reserve, with zero positives among
reviewed negatives. Quick Stockfish evaluation retrieves all four missed
classical forks. The pretrained network retrieves two and shortlists 12
reviewed negatives against seven for the quick evaluation. The independent
puzzle audit is too small to separate the strongest methods.

On the separate engine-labelled puzzle test, teacher-label average
precision is 1.000 for reply logistic regression, .999 for the spatial
network from scratch and .994 for the pretrained version. At 106 slots
they retrieve 70, 68 and 66 of 76 teacher positives, respectively. All
three order all 42 opposite-label pairs correctly. The puzzle test is
close to saturated on known teacher labels.

## What the training target misses

The teacher confirms four of 13 reviewed classical forks and leaves nine
unknown, including three of the four the app missed. It agrees with the
review on all 41 classical moves with a definitive label from both
sources. That agreement covers fewer than half of the 92 definitive
classical reviews. In the reviewed puzzle sample it confirms nine of
14 positives. The training target is selective, and the two classical
samples offer too few missed forks for an estimate of game-wide recall.

At Tsaghkadzor, `d8=Q+` attacks the king and a8 rook. Stockfish's quick
search gives `...Kh7 Qxa8` as one branch. In the stronger `...Rxd8 Rxd8+`
branch the newly promoted queen disappears and a different piece takes the
rook. The reviewed fork survives as a choice between bad defences. The
teacher requires the original attacker to collect in both branches and
leaves this case unknown. [Tsaghkadzor Open round 9](https://lichess.org/broadcast/tsaghkadzor-open-2026/round-9/FNrht2M6)

In a separate classical example, after `Nf6 Bxc6 Rxc6+ Kb7 Rc7+ Kxb6`,
White finally collects the threatened rook with `Nxe8` on ply seven.
The teacher's collection window ends at ply five. Both cases motivate
exact-move examples where a valid defender pays a different or later
price. The current experiment supplies no direct evidence about
positional reasoning or mixed decisions.

The experiment stays offline. CPU inference for the three-model ensemble
took about 2.2 ms for one already encoded move and about 0.2 ms per move
in batches, plus about 0.18 ms for the spatial features on this machine.
The quick tactical summaries and Stockfish search are outside these
timings. The shared Stockfish budget dominates the choice of search cost.

## Reproduce

Use the retained `classifier-rework` directory, the Stockfish 19 binary
matching the engine hash, and Python 3.12 with python-chess, NumPy,
scikit-learn and PyTorch. The recorded fits used PyTorch 2.9.0+cu129.
The export hashes are saved in the results. No new database download or
Python installation is needed when the retained research data and runtime
are available.

1. Run `prepare.py RESEARCH_ROOT STOCKFISH TRANSFER_JSON` to reuse
   `exact-fork-supervision/classical` and find the exact same quick
   branches for the public puzzle and classical reserves.
2. Run `experiment.py PUZZLE_CORPUS PUZZLE_CACHE TRANSFER_JSON RESULTS_JSON --device cuda`.
   The inputs are `neural-motif-transfer/puzzle-corpus-frozen.json` and
   `exact-fork-supervision/puzzles` below the research root. For
   deterministic CUDA set `CUBLAS_WORKSPACE_CONFIG=:4096:8`. CPU is also
   supported. Two CUDA runs reproduced all metrics and public shortlists
   exactly. Timings vary.
3. Run `audit_teacher.py TRANSFER_JSON STOCKFISH TARGET_AUDIT_JSON` to
   measure label coverage independently of fitting.
4. Run `test_experiment.py` for mirror, exact move, masked reply,
   split-leakage and pair-order regression checks.

[Protocol](protocol.json) · [Benchmark results](results.json) · [Training target audit](target-audit.json)
