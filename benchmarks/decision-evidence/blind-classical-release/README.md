# Blind classical release comparison

This reserve is separate from the 72-game classical cohort used during
development. It contains 36 finished games from six previously unused
public events. There is one position per game and twelve per ply
window. The PGN rating bands contain 6 games below 1800, 14 at
1800–2199 and 16 at 2200 or above. Every selected event specifies
90 minutes and 30 seconds of increment from the start.

The selection script uses played game data alone. It excludes prior
game prefixes, exact broadcast game URLs and colour-normalized
boards, and caps each event at six games. The source manifest records
the original PGN hashes and the hash of each supplied prior sample.
Raw downloads remain outside this checkout.

The product version under test is fixed at `dde59f6f`. The
[classical review protocol](../current-classifier-audit/classical-review-protocol.md)
defines the six axes and the exact-move requirement. Its 72-game
stratification does not apply to this smaller reserve. A single
engine-assisted reviewer sees the common Stockfish frame, the deeper
comparison and match-relevant replies before either classifier is run.
The retained reference records actual moves and supports unresolved
labels where the checked lines do not settle the question. The
original and frozen product then receive the same offline app-budget
frame. The separate [live Windows run](../native-desktop/README.md)
measures the adaptive workflow.

The review is [sealed](reference.json). The common and deeper frame
files are small fixtures containing only the 36 frozen positions.
The label hashes cover these exact captures. The recorded notes
include legal UCI witnesses from them. `seal.py` checked the
witnesses against the frame prefixes and the exact move in each
scope before either classifier produced a prediction.
[Common frames](app-frames.json) · [Deeper frames](reference-frames.json)

## Matched fixed-budget result

Positive counts and false calls refer to definite reference labels.
One person reviewed the frames with Stockfish assistance. Unresolved
axes are excluded from both the positive and negative denominators.

| Reviewed question | Original found | Rebuild found | False calls, original → rebuild |
| --- | ---: | ---: | ---: |
| Tactical position | 1/22 | 3/22 | 0 → 0 of 4 |
| Tactical exact move | 0/16 | 0/16 | 0 → 0 of 9 |
| Tactical actual mistake | 0/2 | 1/2 | 0 → 0 of 31 |
| Positional position | — | 6/26 | No definite negatives |
| Positional exact move | — | 4/19 | No definite negatives |
| Positional actual mistake | 0/2 | 0/2 | 0 → 0 of 31 |
| Mixed position | — | 0/12 | — → 0 of 4 |
| Mixed exact move | — | 0/6 | — → 0 of 9 |

The rebuilt report is unclear about the position on 26 boards and
about the exact move on 28. The exact tactical move has one
additional called case with an unresolved tactical reference. The
separate motif checks include one positive for removing the defender,
which both versions miss. The sample has no definite mixed mistake.
Individual motif results and event-group intervals are in the
[scorecard](results.json).

- In an Oskemen game, `...Kc7` allows `Nxd6` and the loss of two
  central pawns after the exchanges. The rebuild explains that
  contrast in the **position** summary, and the **exact choice**
  summary still misses why `...Bc7` works.
  [Game](https://lichess.org/broadcast/oskemen-open-2025-masters/round-2/QL92CGX8/ugZnE2VF)
- In a US Masters game the new mistake report follows
  `Rh1 Qd2+ Kc4 Qb4+ Kd3 Qxe4+ Kxe4 Rxh1`. The checks lead to
  the queen trade and remove the h1 rook's defender.
  [Game](https://lichess.org/broadcast/2025-us-masters/round-1/IPBsoUzM/CZ3C3NCa)
- The quiet `Qf4` stops `...Qh2+` and supports e5. Both
  fixed-budget reports miss the relationship. A search giving
  `...Qh2+` against other candidates is useful evidence even
  when the exact good move prevents it.
  [Game](https://lichess.org/broadcast/2025-australasian-masters/round-1/5v265rsE/I8ER9zId)

The worker took 99 ms median for all three questions. The original
root scanner took 47 ms median and its mistake pass took less than
a millisecond median. Those timings skip Stockfish. The common
captures completed about 205 million search nodes across 36 games.
The offline review completed about 481 million and disagreed with
the common frame's first move in 11 of 36 games.
[Search and baseline receipt](frame-receipt.json)

## Live Windows transfer

The exact same revision returned a Decision Evidence report on
all 36 games through **Analyse last move**. Every sealed exact
candidate remained available. The live engine nominated a different
first move on two boards. The original classifier received the
live app's engine lines for a matched comparison.

| Reviewed question | Original on live frames | Rebuild on fixed frames | Rebuild in the live app |
| --- | ---: | ---: | ---: |
| Tactical position | 1/22 | 3/22 | 5/22 |
| Tactical exact move | 0/16 | 0/16 | 1/16 |
| Tactical actual mistake | 0/2 | 1/2 | 1/2 |
| Positional position | — | 6/26 | 6/26 |
| Positional exact move | — | 4/19 | 4/19 |
| Positional actual mistake | 0/2 | 0/2 | 0/2 |
| Mixed position | — | 0/12 | 0/12 |
| Mixed exact move | — | 0/6 | 0/6 |

Both versions make zero false calls on the 4 definite tactical
position negatives, 9 exact-move negatives and 31 mistake negatives.
The live app takes 9.11 seconds median and 18.08 seconds maximum
from the analysis action to the visible report. The worker runs
twice in 12 of the 36 games.

The live `Qc1` report establishes access to g5 through a different
line from the one the blind review used. It shows
`Qc1 Qb4 Bxh5 gxh5 Qg5+ Kh8 Qxh5` and describes the fork as a
resource in that line. The blind review follows `...Qc8` and uses
the same g5 square to attack h5 and e7. Both support a tactical
reason for the exact quiet move.
[Australasian Masters game](https://lichess.org/broadcast/2025-australasian-masters/round-9/8QD7Hix8/I7jwarwi)

The `Rb7` rook sacrifice followed by `Ne6+` appears only on the
deeper reference frames among the fixed captures. Neither app
workflow explains it. The bishop-removal defence
`Rxf3+ Kxf3 Kb7 Rxb6+ Kxa7` is already present in the common
frames, and both classifiers still omit it. More search can supply
the first line. The second example needs better attribution of the
existing evidence.
[Live scores](windows-results.json) · [Run receipt](windows-receipt.json)

## Reproduce

Run from the repository root with the project's dependencies and
Python with python-chess. Use a new scratch directory whose path is
in `$decisionReserve`. The comparison uses the checked-in frames,
so an engine run is optional. The committed pre-rebuild source
matches the original working scanner on every non-timing field
in this replay.

```powershell
$bench = 'benchmarks/decision-evidence/blind-classical-release'
$audit = 'benchmarks/decision-evidence/current-classifier-audit'
$old = 'benchmarks/decision-evidence/cross-scope-audit'
python "$audit/classical_score.py" "$bench/app-frames.json" "$bench/reference.json" $decisionReserve
git show a4428e35:src/utils/tacticalMotifs/causalTactics.ts |
  Set-Content "$decisionReserve/original-causal.ts" -Encoding utf8NoBOM
$env:DECISION_SCORE_ARM = 'original'
$env:DECISION_SCORE_ROOT_MOTIFS = '1'
$env:DECISION_BASELINE_CAUSAL = "$decisionReserve/original-causal.ts"
$env:DECISION_SCORE_INPUT = "$decisionReserve/classical-legacy-input.json"
$env:DECISION_SCORE_OUTPUT = "$decisionReserve/classical-original.json"
node node_modules/vitest/vitest.mjs run --config "$old/archive.config.mjs" archive.bench.ts
$env:DECISION_AUDIT_REVISION = 'dde59f6f'
$env:INTERFERENCE_MODE = 'archive'
$env:INTERFERENCE_INPUT = "$decisionReserve/classical-replay-input.json"
$env:INTERFERENCE_OUTPUT = "$decisionReserve/current.json"
node node_modules/vitest/vitest.mjs run --config "$audit/replay.config.mjs"
python "$audit/classical_score.py" "$bench/app-frames.json" "$bench/reference.json" $decisionReserve --score "$decisionReserve/results.json" --worker v66 dde59f6f "$decisionReserve/current.json"
```

For the live run, use revision `dde59f6f` and `selection.json`
with the [Windows audit instructions](../native-desktop/README.md).
Once the capture completes, prepare the original inputs with
`native-desktop/classical-replay.py CAPTURE SELECTION REFERENCE INPUT`.
Replay the original on that input with the same Vitest configuration.
Run `classical-replay.py CAPTURE SELECTION REFERENCE OUTPUT --score
ORIGINAL_REPLAY FIXED_REPLAY` to compare it with the saved fixed arm.
