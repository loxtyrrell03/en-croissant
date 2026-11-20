# Discovered attacks and captures that cannot wait

Decision assessment v37 follows the piece originally exposed by an opened
line. A recapture of a newcomer, a target that moves away and a blocked
line that opens again are distinct events. A retained discovery can pay
off on the next turn or one turn later. The witness checks legal access to
the original piece, continuity of the ray and a concrete use such as a
check, profitable capture or connected exchange. When the capture starts
an exchange that pays off later, the evidence ends at that payoff.
This is evidence in the displayed continuation.

Discovery comparisons match the opening move, slider and target. In
Reykjavík, Nf3+ uncovers a queen attack on e4. A rook attack on e4 in a
different variation cannot cancel that diagnosis. In Prague, Rh4 opens
the bishop's line from c5 to f2. The bishop takes the original f2 pawn
after Rh1 Rxh1 Kxh1. At the New York State Girls Championship the
stronger Rxd5 removes the pawn that takes the bishop after Bxe4. Trading
rooks on d5 adds no discovery label to that explanation.
[New York round 6](https://lichess.org/broadcast/10th-annual-new-york-state-girls-championship-2026/round-6/IJN2nA6R)

Some critical captures need no motif badge. Where two saved searches
show an early material gain and an appreciably weaker quiet alternative
lets the same piece escape an immediate loss, the assessor can explain
the opportunity. At Box Hill, exd4 wins the knight. After castling,
Nf5 lets it escape a profitable capture. The move and position receive
tactical evidence. The same check recovers the tactical axis in a
Bavarian Open position with an independently established strategic
component. The position becomes mixed.

## Matched replay

The benchmark counts unique witnesses by the position, opening ply and
exact line through the target capture. Python-chess replays the opening
and capture independently. This directly checks whether an original
enemy target existed and survived to the capture. It provides a scoped
false-positive count, with no claim to adjudicate all tactical motifs.

| Cohort | Invalid future or replaced targets, before → after | Intact target witnesses, before → after | New captures at the delayed horizon |
| --- | ---: | ---: | ---: |
| Historical archive, 1,051 requests | 583 → 0 | 350 → 341 | 87 |
| Separate classical cohort, 202 requests | 100 → 0 | 60 → 61 | 16 |
| 450 held-out public puzzle solutions | 12 → 0 | 99 → 97 | 0 |

The first variant used the local exchange result alone and lost 16
intact puzzle witnesses. Checking forcing tempos and connected
recaptures retained 14 of those 16. The final variant preserves the
consequential discovered attack in puzzle 0RkoW. The opened queen
captures on f4, and the knight that opened the ray inserts Ne2+ before
collecting the recapturing queen. Two intact witnesses remain absent
from the puzzle replay. One finishes with a queen trade after an
off-square capture. The other ends before its material consequence is
established. [Lichess puzzle 0RkoW](https://lichess.org/training/0RkoW)

Puzzle theme labels provided the strata. A theme on an entire puzzle is
an imperfect label for any one move. Of 150 source-tagged discovery
puzzles, the old extractor found a discovery in 99 and the new extractor
in 96. On 150 related-theme and 150 other puzzles, the counts go from
seven to one. This does not treat every untagged discovery as false.
[Lichess puzzle dataset](https://database.lichess.org/#puzzles)

In the historical report replay, 15 position assessments change their
tactical axis and the played-mistake categories all agree. Nine changed
positions have an earlier reviewed tactical judgment. Seven gain
agreement and two lose it. Removing a false explanation can leave a
genuine tactical position incompletely described. The Buongoma exchange
and the Amateur U1700 promotion race are two such cases. The separate
classical cohort has six revised explanations and agrees on every
position and mistake category. The new causal check adds no engine
requests. The existing evidence panel was exercised with the prepared
New York game through the actual report worker at 320, 390 and 900 pixels.

## Reproduce

Use the En Croissant root as the working directory. Run
`prepare.py LAB OUTPUT archive` and `prepare.py LAB OUTPUT classical` to
restore the matched cached requests. `puzzles.py SOURCE OUTPUT` consumes
the frozen November public sample from the prior neural motif benchmark.
The puzzle extractor needs legal lines. The placeholder search depth and
score in that replay carry no engine or position-assessment meaning.

```powershell
$suite = 'benchmarks/decision-evidence/discovered-target-identity'
$env:DISCOVERY_INPUT = 'C:/path/to/prepared-frames.json'
$env:DISCOVERY_ARM = 'baseline'
$env:DISCOVERY_OUTPUT = 'C:/path/to/baseline-output.json'
node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs" replay.bench.ts
$env:DISCOVERY_ARM = 'candidate'
$env:DISCOVERY_REVISION = 'HEAD'
$env:DISCOVERY_OUTPUT = 'C:/path/to/candidate-output.json'
node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs" replay.bench.ts
```

Use the candidate commit containing this benchmark. Run
`audit.py REPLAY OUTPUT` on each raw replay. The comparison script reads
`{cohort}.json`, `{cohort}-before.json`, `{cohort}-final.json` and the two
`{cohort}-audit-{before,final}.json` files. Pass the directory and the
cohort names to `compare.py`. The five public fixtures also run through
`decisionDiscoveredTargets.test.ts`.
