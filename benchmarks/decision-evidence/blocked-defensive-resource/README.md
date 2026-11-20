# When a move obstructs a defensive resource

The prototype finds an exact shared continuation after the played and
stronger moves. It asks whether the played piece blocks a legal defence
at the point where it is needed. Both reached boards receive independent
Stockfish searches. A third search excludes the proposed defence from the
stronger board. The cheaper variant compares the runner-up from its
unrestricted MultiPV search. A score difference needs corroboration from
the same material or mating consequence in the played and excluded lines.

| Sample | Nominations | Score contrast | Verified shared consequence |
| --- | ---: | ---: | ---: |
| Archive, 1.4M nodes per search | 27 | 2 | 2 |
| Archive, 2.4M nodes per search | 27 | 3 | 2 |
| Targeted archive recheck, 6M nodes per search | 4 | 3 | 2 |
| Fresh classical reserve, 6M nodes per search | 7 | 0 | 0 |

The two- and three-search variants agree on both verified cases. In the NYC
game, 31.Rd1 occupies the square needed for Qd1 against a promotion threat.
The tested Qd1 line draws after 31.Re1. The b2 pawn promotes in the played
line and when Qd1 is excluded from the stronger continuation. The ordinary
frame stops before the shared checkpoint. [Fall NYC Norms game](https://lichess.org/broadcast/2026-fall-nyc-norms/round-3/0VwGgtP4/y3XU0Bki)

At Fagernes, 30.Rhd1 prevents the other rook from reaching d1 after Rbc8.
After the stronger 30.g4, 31.Rdd1 is available. Both weakened continuations
end with Rc2+ and Rxf2 gaining material. The existing classifier already
classifies this mistake as tactical and describes the subsequent double
attack. The comparison supplies the earlier defensive cause. [Fagernes round 10](https://lichess.org/broadcast/fagernes-international-autumn-2026-gm/round-10/GqyZIfeA)

The reserve contains 162 separate classical games across 44 events.
Following the stronger line produced seven nominations and none verified.
Following the opponent's leading reply to the played move produced 48
nominations. Another defence held in 46 and the remaining two lacked
the required score contrast. The latter search used 67.2M requested nodes.
The stronger-first comparison used 33.6M requested nodes for its
two-search arm at 2.4M per checkpoint. No fresh positive was found, so
this sample cannot estimate recall and the prototype stays offline.
[Counts and replay hashes](results.json)

## Reproduce

From the repository root, replay the exact saved frames in the TypeScript
prototype.

```powershell
$suite = 'benchmarks/decision-evidence/blocked-defensive-resource'
$env:BLOCKED_INPUT = "$suite/fixtures.json"
$env:BLOCKED_CHECKS = "$suite/checkpoint-fixtures.jsonl"
$env:BLOCKED_OUTPUT = Join-Path $env:TEMP "blocked-$PID.json"
node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs"
```

To regenerate the reserve frames, run the neighbouring
`promotion-intermezzo/gather.py` with `reserve-sample.json`, a new output
path and the Stockfish 19 executable pinned in `results.json`. Run
`nominate.py OUTPUT FRAMES`, then `check.py INPUT OUTPUT STOCKFISH --nodes
6000000`, and pass the resulting searches to `compare-variants.py`. The
retained broadcast inputs and exact deep reserve checkpoint lines allow
the comparison to be audited independently.
