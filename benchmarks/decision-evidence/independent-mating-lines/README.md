# Independent reply coverage and mating continuations

En Croissant already used a separate search of the best move's replies.
Some positions went unclassified despite a complete mating result. In
the Korea Standard Open game, both searches reached mate after Rb8+.
The move assessment recorded mate in five. Position character discarded
it because the only separately identified motif was a preparation
whose payoff came late. In the Voivodina game, both searches reached
mate in eight after g6 and the position assessment marked it unclear.
[Exact engine frames](examples.json)

Version 28 treats mating evidence separately from tactical motifs. It
validates the exact board, every move and the terminal checkmate in
both searches. The reported mate distances must agree after accounting
for the candidate move already played. The result names the winning
side, including when that side is the opponent. The position and move
panels display the two recorded continuations under Show evidence.
The existing mate-in-one proof and short-mate fallback remain available.

## Evidence from replays

| Cohort | Tactical calls before | Tactical calls after |
| --- | ---: | ---: |
| 203 reviewed classical positions | 28 of 126 | 29 of 126 |
| 40 ordinary positions from separate events | 5 of 26 | 6 of 26 |
| 18 fresh checking-sequence positions at the standard budget | unchanged | unchanged |
| Independent Freiburg case with full mating lines at a wider budget | unclear | tactical |

The 40-case sample includes the Voivodina development example. A separate
18-case sample used recorded checks to enrich for forcing continuations.
Its sole root search with a mate score was f6+ at Freiburg. The standard
independent reply search still gave finite scores. A wider repeat of
every case with a root mate score ran 20 million nodes on each
side of that candidate move. Both searches then produced complete mate
in eight. Version 27 still marked the same proof unclear. Version 28
recognised it. The wider repeat is a benchmark condition. The app adds
zero searches.

There were zero added reviewed false positives and no change in mixed
assignments. The 472 archived position replays retained their position
categories, with complete verified mating lines now attached to 12.
All 317 valid paired mistake diagnoses and their statuses match.
Twenty focused tests passed. The source panel displayed both mating
lines through its real classifier worker at 320, 390 and 900 pixels.
These are source results. [Metrics and checksums](results.json)

## Where more search helped

The matched-width study supplied the same 203 classical positions with
the best move's replies, with the existing refutation probe, with one
more competitive root's replies, then with all available alternative
replies. The sample combines several earlier public evaluations.
The labels are from one reviewer; an uncertain axis remains unknown.

| Reply policy | Tactical true / false | Positional true / false | Mixed true / false |
| --- | ---: | ---: | ---: |
| Leading move only | 28 / 0 | 37 / 0 | 3 / 0 |
| Existing refutation probe | 28 / 0 | 37 / 0 | 3 / 0 |
| One more root | 29 / 1 | 46 / 0 | 4 / 0 |
| All available roots | 29 / 2 | 49 / 0 | 4 / 0 |

These are axis-level matches. A closer inspection found some true
positional axes attributed to incidental features. For example, the
additional tactical coverage in one mixed position came with an
existing explanation citing the wrong pawn. The full-width replay
used at least 402 million extra nodes across the sample, counting
the final attempt per branch. A separate 40-board sample adds three
positional-axis matches with those extra replies and gains no tactical
or mixed calls.

The second prototype also considers tactics played by the opponent
after one or more strong root moves. It recovered a genuine mixed
development example. After Kf7 or Kf6, Nxd8 wins the exchange and
the rooks contest the pawn on d6 after Rad1. Neither the tactical
branch verifier nor the file-contest comparison added a classification
on the independent 40-case sample. The prototype and its exact
engine lines are archived as research.

## Reproduce

Each public input contains the exact three-line roots and separate reply
search frames where available. From the repository root set a fresh
output path and choose the input and runner. Use `public-input.json` or
`fresh-input.json` for the reply-width comparison. Use the mating
runner for the version comparison, and include the held-out wider
Freiburg frame to reproduce that positive.

```powershell
$env:REPLY_COVERAGE_INPUT = 'benchmarks/decision-evidence/independent-mating-lines/mate-holdout-wide.json'
$env:REPLY_COVERAGE_OUTPUT = 'C:/path/to/new-mating-replay.json'
$env:REPLY_COVERAGE_MATING_ONLY = '1'
& ./node_modules/.bin/vitest.CMD run --config benchmarks/decision-evidence/independent-mating-lines/vitest.config.mjs
```

The default reads the archived v27 classifier from Git. Set
`REPLY_COVERAGE_REVISION` to the v28 source commit for comparison.
Use the corresponding version of the other source dependencies when
reproducing from a later development branch. The collection scripts
reuse the [existing Stockfish protocol](../opened-rook-file/prepare.py).
[Public source rounds and sample provenance](protocol.json)
