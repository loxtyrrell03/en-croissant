# Strategic continuations and learned mixed-position ranking

Two comparisons address different failure modes. The continuation experiment
asks whether the position assessment can explain a durable plan seen in two
viable moves. The learned experiment asks which unresolved positions are
worth inspecting for both tactical and positional evidence. A successful
nomination still needs a chess explanation.

## Continuation evidence

The prototype compares the leading Stockfish line with the next two root
choices from the same search, within 100 centipawns of the leader. It can
also use a separate reply search after the leader. The comparisons look
for initiative on a rook file, an advanced passed pawn, a pawn-backed
knight outpost, a central pawn exchange or an exchange removing one
bishop of a pair. They require legal replays and a common point at which
material has settled. The four arms differ in whether they require
the asset to be used, a separate search to corroborate at least one
branch, or allow two different assets from the same strategic family.
The stricter revision follows the original rook through its moves,
checks that a contest has an unobstructed rook line and rejects
transpositions before the witnessed effect.

The 111 development boards come from previous public classical samples.
The first holdout contains 36 positions from the Kovin IM 8 and the Puerto
Rico team open. The reserve contains 35 positions from the SPICE Cup,
Türkiye Cup and Bangladesh National Women's Championship. Each fresh
position comes from a different game. The references were reviewed from
legal Stockfish lines before seeing scores or explanations for each
fresh sample. One reviewer supplied independent tactical and positional
labels, with uncertain outcomes retained. No real game move is passed to
the benchmark position classifier. [Source and search manifest](protocol.json)

| Method | First holdout positional positives | Reserve positional positives |
| --- | ---: | ---: |
| Incumbent | 6/31 | 7/30 |
| Matching board features, first prototype | 13/31 | 10/30 |
| Observed use in both lines, first prototype | 10/31 | 9/30 |
| With a separate reply search, first prototype | 9/31 | 9/30 |
| Allow different assets of the same kind, first prototype | 9/31 | 10/30 |
| Matching board features, stricter revision | 13/31 | 10/30 |
| Observed use in both lines, stricter revision | 9/31 | 8/30 |
| With a separate reply search, stricter revision | 8/31 | 8/30 |
| Allow different assets of the same kind, stricter revision | 9/31 | 9/30 |

Every row has one false positional call among four reviewed negatives
in the first holdout and zero among three in the reserve. The first
holdout has one uncertain positional reference called by every method.
The same underlying position classifier detects four of 21 and eight
of 25 tactical positives and one of 16 and zero of 20 mixed positives.
The false tactical counts are zero of four and zero of five. The false
mixed counts are one of eight and zero of eight. All six replays are
recorded in [strategy-results.json](strategy-results.json).

The broader arms receive credit for a positive positional axis even when
they report an incidental action. For example, one endgame reference is
about advancing the f- and b-pawns, while the broad arm cites a rook's
move to d1. The revised contrast finds two genuine features in the
reserve. After either ...Ke6 or ...Nxd4, cxd4 produces a passed pawn
stopped by ...Kd5. In a different game, ...Rd6+ leads to advancing the
c-pawn and ...Kd7 leads to advancing the a-pawn. Both examples come from
the SPICE Cup. The sample is too small and too heavily positive to
support an estimate of false alarms in normal use. The initial
development case with a delayed fork still needs an independent
strategic explanation. The comparison remains offline.

## Neural triage

The same 259 labelled positions and frozen Maia-3 5M checkpoint used in
the earlier Maia experiment were used to fit the models. The test
tournaments, game hashes and colour-normalized boards are excluded from
fitting. All methods use the same leading engine lines. A small neural
network on engine-line features and frozen Maia representations were
compared with logistic regression and a boosted tree using those same
engine lines. A separate reserve-only comparison learns a mixed target
directly using logistic regression, the small neural network and logistic
regression with the frozen Maia board representation. The independent
tactical and positional targets are also retained in the original arms.
[Previous Maia protocol](../maia-branch-probe/README.md) |
[Maia-3 checkpoint](https://huggingface.co/UofTCSSLab/Maia3-5M)

| Mixed-position ranker | First holdout, positive / false / uncertain | Reserve, positive / false / uncertain |
| --- | ---: | ---: |
| Stockfish evaluation gap | 4 / 3 / 1 | 6 / 0 / 1 |
| Legal line logistic | 4 / 0 / 4 | 6 / 0 / 1 |
| Legal line tree | 6 / 1 / 1 | 7 / 0 / 0 |
| Small legal line network | 4 / 1 / 3 | 6 / 0 / 1 |
| Maia predicted human moves plus legal lines | 4 / 0 / 4 | 7 / 0 / 0 |
| Maia board representation plus legal lines | 4 / 1 / 3 | 6 / 0 / 1 |
| Maia position changes along the lines | 5 / 1 / 2 | 6 / 0 / 1 |
| Direct mixed target, logistic | — | 6 / 0 / 1 |
| Direct mixed target, small network | — | 6 / 0 / 1 |
| Direct mixed target, Maia board plus legal lines | — | 7 / 0 / 0 |

The first holdout's Maia continuation representation has average
precision 0.883 against the tree's 0.851 across the reviewed unresolved
mixed positions. The direct Maia head reaches 0.978 against 0.959 on the
reserve, where the simple tree already fills every slot. Unknown
references consume review slots and are excluded from average precision.
For tactical ranking, the tree leads 7/8 to the best Maia arm's 6/8
on the first holdout and ties at 5/5 on the reserve. For positional
ranking, both find 6/6 in each sample. The fixed review budget sometimes
reaches its ceiling. Within that budget, there is no reproducible gain
from the neural component. A ranking may capture patterns in positions
without identifying a legal mechanism.

The continuation experiment takes about 1–3 ms median per board for
all four arms together, excluding baseline classification and search.
The neural comparison uses zero additional engine searches and takes
about 43–46 ms median for a CPU batch of seven Maia positions per
decision, excluding feature preparation and model load. Both prototypes
run only in the benchmark.

[Position witnesses](witnesses.json) |
[First holdout ranking results](holdout-neural-results.json) |
[Reserve ranking results](reserve-neural-results.json)

## Reproduce

1. Run the replay from the repository root using the existing Vitest
   executable with the research configuration below. Use a fresh output
   path. Set `DECISION_STRATEGY_VERSION` to `v1` for the initial
   prototype or `v2` for the revision, and
   `DECISION_STRATEGY_INPUT` to one of `development.json`,
   `holdout.json` or `reserve.json` in this directory.
   The runner reads the incumbent's three changed classifier modules
   directly from the recorded Git revision. Use that revision for the
   rest of the source when reproducing on a later checkout.

   ```powershell
   $env:DECISION_STRATEGY_VERSION = 'v2'
   $env:DECISION_STRATEGY_INPUT = 'benchmarks/decision-evidence/strategic-continuation-contrast/reserve.json'
   $env:DECISION_STRATEGY_OUTPUT = 'C:/path/to/new-reserve-output.json'
   & ./node_modules/.bin/vitest.CMD run --config benchmarks/decision-evidence/strategic-continuation-contrast/vitest.config.mjs
   ```

2. Run `score.py` with a new output path and the six replay outputs.
   The included inputs contain the exact engine frames, so Stockfish
   can be skipped for a replay. To regenerate a frame, pass its FEN
   and the executable to `examine` in the neighbouring
   [preparation script](../opened-rook-file/prepare.py).
3. Use the checkpoint and 259-case training replay and cache
   manifest from the [earlier benchmark](../maia-branch-probe/README.md).
   Run `neural-transfer.py REPO CHECKPOINT OUTPUT --train REPLAY MANIFEST
   --transfer SAMPLE VITEST_OUTPUT` in the same Maia and scikit-learn
   environment. On the initial holdout, read the fixed-head `results`
   only. The direct-target arms were specified after that result and
   receive their independent evaluation on the reserve.
