# Frozen Maia-3 representations for decision analysis

The puzzle-trained sequence model classified solution tags well but transferred
poorly to exact classical moves. This experiment reuses the frozen Maia-3 5M
human-move model and trains separate supervised tactical and positional
probes. The lower score ranks candidates for mixed review. It has no
probability interpretation. [Maia-3 model card](https://huggingface.co/UofTCSSLab/Maia3-5M)

All new probes start with existing Stockfish evaluation and legal-line
features. One adds Maia's legal-move probabilities, one adds the pooled
representation of the original board, and one adds differences between
the two continuations after plies two and four. A same-size randomly
initialized encoder controls for the extra features in the branch arm.
Classical alternatives come from separate reply searches when their exact
board matches. Position-character alternatives are the two leading root
lines. This position task has no input from the game move or the players.

## Held-out results

Both transfer sets were previously reviewed for other experiments and were
excluded from fitting these rankers. A tournament, game or color-normalized
board cannot cross a split. There were 225 usable historical mistake
decisions out of 226, 48 mistakes and controls from 24 held-out games,
and two descriptive 18-position shelter replays. The position experiment
used 259 ordinary classical training positions and 33 positions from three
separate tournaments. Each training fold keeps tournament families together.

The counts are reviewed positives, negatives and uncertain nominations at
the same review budget and at most one nomination per game. They measure
triage yield. A diagnosis requires separate verification.

| Method | Tactical mistake, 4 slots | Positional mistake, 4 slots | Mixed mistake, 4 slots |
| --- | ---: | ---: | ---: |
| Stockfish loss | 4 / 0 / 0 | 1 / 0 / 3 | 1 / 0 / 3 |
| Legal line boosted tree | 4 / 0 / 0 | 4 / 0 / 0 | 1 / 0 / 3 |
| Legal lines plus Maia root | 4 / 0 / 0 | 3 / 0 / 1 | 1 / 0 / 3 |
| Legal lines plus Maia branches | 2 / 1 / 1 | 1 / 0 / 3 | 1 / 0 / 3 |
| Legal lines plus random encoder branches | 3 / 0 / 1 | 3 / 0 / 1 | 1 / 0 / 3 |

The Maia branch probe nominated the Fall NYC intermezzo after
`...Qe6 Rf6 Bxf6 Qd3+`, as did the Stockfish loss ranking and the tree.
It also nominated a Benidorm control where `f4` and `axb4` both
held the balance. The tree nominated a genuine tactical error from
the same game on a different move. Twenty of the 48 primary mixed
labels remain uncertain and only four are positive.

| Method | Tactical position, 7 slots | Positional position, 5 slots | Mixed position, 7 slots |
| --- | ---: | ---: | ---: |
| Legal line logistic | 7 / 0 / 0 | 5 / 0 / 0 | 3 / 2 / 2 |
| Legal line boosted tree | 6 / 1 / 0 | 5 / 0 / 0 | 5 / 1 / 1 |
| Legal lines plus Maia policy | 6 / 1 / 0 | 5 / 0 / 0 | 5 / 1 / 1 |
| Legal lines plus Maia root | 7 / 0 / 0 | 5 / 0 / 0 | 5 / 0 / 2 |
| Legal lines plus Maia branches | 7 / 0 / 0 | 5 / 0 / 0 | 5 / 0 / 2 |

Maia's root model and the tree each selected five reviewed mixed
positives. Only one was common to both selections. The root model
replaced a known negative with an uncertain case in the W2000 sample.
The 33-position transfer gives mixed average precision of 0.885
for the root model, 0.863 for evaluation-only logistic, and 0.748
for the tree. On the 259-position grouped replay, the root model
also has higher mixed average precision (0.896 versus 0.850 for
line logistic), with fewer reviewed positives in the fixed queue
(34 versus 37). Broad ranking and short-list yield tell different
stories. The uncertain labels are excluded from average precision
and still consume review slots.

No neural arm cleared the frozen gate of two more reviewed positives
at the same budget, improvements on at least two sources, and no more
reviewed negatives. The tactical and positional queues also have a
ceiling here because simpler methods already fill their small
budgets. The strongest remaining signal is mixed position ranking
from the original board. This experiment found no evidence to add
neural move or motif verdicts to the app.

## Reproduction

- Use the checkpoint and replay SHA-256 values in `protocol.json` and
  `position-protocol.json`. The pretrained weights remain outside Git.
  The model card dates its human game data from January 2023 to July
  2025. [Maia-3 model card](https://huggingface.co/UofTCSSLab/Maia3-5M)
- For the mistake experiment, recreate the three v46 historical
  replays described in the v48 report. Give the v47 initial and reserve
  replays and the v49 primary replay to
  `decision-evidence-maia-probe.py --transfer` in that order.
  [v48 model protocol](../mistake-model-v48/summary.json)
  [v49 equal search budget](../mistake-search-budget-v49/protocol.json)
- For position character, give the 259-case v41 worker replay and its
  cache manifest to `decision-evidence-maia-position-probe.py --train`.
  Give the v32 sample, reviewed reference, breadth engine output and
  worker output to `--transfer`. Both commands also take the protocol
  path, the local checkpoint path and a new report path.
  [v41 grouped model replay](../line-model-v41/summary.json)
  [v32 position reference](../maia-nomination-v32/tournament-position-reference-v32.json)
- Both runs were repeated and all rankings, selections and counts
  reproduced. The pretrained seven-position CPU batch took about 44
  to 46 ms median per decision, excluding model load and Stockfish.
  The pre-existing engine searches were held fixed. There is no
  runtime integration or new deployed diagnosis.
