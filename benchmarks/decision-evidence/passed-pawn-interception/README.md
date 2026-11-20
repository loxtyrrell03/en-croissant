# Costly trades to stop a passed pawn

See the [application follow-up](app-transfer/README.md) for the revised
comparison and the verified diagnoses in Decision Evidence.

This trial asks whether a played move makes a near-promotion pawn expensive
to stop. A valid explanation follows the original pawn and compares what
happens after the played and stronger moves. The effect is tactical when
the pawn forces a material concession. Any independent positional change
requires separate evidence.

In the Asian Disabilities Championship development case,
`...Kd7 Re7+ Kc6 Rc7+ Kd5 d7 Rd8 Be7` leaves Black choosing how to stop
the d-pawn. `...Rxd7 Rxd7+` costs a rook for the pawn. In the restricted
search, avoiding the capture with `...Rh8` allows `d8=R+ Rxd8 Rc5+ Ke6
Bxd8`, which costs the same rook. The first checker missed the second
line because it ended before the check and recapture completed. Replaying
the same defender's rook through the intervening check recovered it.
[Development engine frames](examples.json)

## Experiment

- **Repeated trade.** Both engine searches after the played move show
  the same original passed pawn on the seventh rank, taken by a piece
  at a material cost. There is no comparable paid trade in either of the
  stronger lines available at the same search budget.
- **Restricted replies.** At the shared checkpoint, use two Stockfish
  searches, one permitting only captures of the pawn and one excluding
  them. The separate lines must still show a costly interception or a
  material conversion by the same pawn. An uncorroborated checkpoint or
  a different threat leaves the rule silent.
- **Cheaper defence.** Require both stronger lines to remove the same
  pawn without material loss through the exchange and following reply.
  This verifies an actual defensive resource. It uses existing analysis.
- **Both checks.** Require the cheaper defence and the restricted replies.

A single reviewer assessed the legal lines, plus separate Stockfish 19
reply searches at 2.4 million nodes and a restricted defence at 1.65
million nodes. Scope is an expensive interception of the same pawn.
A negative can still contain a different tactical mistake. A missed call
includes an abstention on a positive. The reference is frozen before the
scored runs. The shared comparison inputs, exact search settings, seed,
game grouping and source slices are in the protocol.
[Protocol](protocol.json), [Lichess puzzle database](https://database.lichess.org/#puzzles)

## Results

| Puzzle sample | Reviewed positives | Reviewed negatives | Repeated trade true / false | Restricted replies true / false | Cheaper defence true / false | Both checks true / false |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First, 113 games | 25 | 69 | 16 / 2 | 11 / 2 | 5 / 0 | 3 / 0 |
| Untouched reserve, 85 games | 22 | 46 | 17 / 3 | 13 / 2 | 7 / 0 | 6 / 0 |

The first puzzle sample informed the cheaper-defence condition. The reserve
uses a different source slice with one position per game. Across the two
puzzle cohorts, 25 uncertain cases and 11 ineligible cases are outside the
binary denominators. Of the cheaper-defence rule's seven reserve matches,
four cases had unclear mistake reports in the current worker, two already
had tactical support, and one had no mistake report. These are experimental
candidates for additional explanations.
[First reference](primary-reference.jsonl),
[reserve reference](puzzle-reserve-reference.jsonl)

The original restricted-reply rule made two false calls in each puzzle set.
For `LNC1C`, deeper searches can also find `Bxe2 Rxe2` after the stronger
move. In `JVWeJ`, both choices pay a comparable price on f2. Searches on
the worse board cannot distinguish these from genuinely new costs. The
better board is where the distinction must be checked. In reserve case
`PFYbG`, the stronger `Ke4` lets `Nxd2` win the pawn, whereas `Ke6`
allows `...Bb4` to defend d2 and make `Nxd2 Bxd2` lose the knight.
[Review and alternate searches](examples.json), [reserve engine frames](puzzle-reserve.json)

Across 135 separate classical games, 117 moves were ineligible because
the played move led the preview or the paired frame did not establish
at least a 75-centipawn finite loss. The remaining reviews yielded one
confirmed interception, 13 negatives and four uncertain cases. The
current worker already marks the positive tactical. The repeated rule
identifies its more specific explanation. The extra probes do not
corroborate the causal claim. The trials produced zero newly supported
classical diagnoses and remain offline. Sparse classical positives and a
single reviewer limit the inference. This study does not estimate broad
tactical, positional or mixed accuracy.
[Classical reserve reference](classical-reserve-reference.jsonl), [Exact scores](results.json)

The two restricted searches use at most 1.2 million requested nodes each.
They add a median of roughly 1.1 seconds for searched reserve puzzles on
this machine. Requiring the cheaper defence before the restricted searches
cuts down the number of probes. The cheaper defence alone produces one
more confirmed reserve result than both checks together, with zero extra
Stockfish searches. The dominant remaining misses use a blockade, pawn
race or a different tactical resource in the better line. The strict
capture check leaves these unclear.

## Reproduce

Run from the repository root with Stockfish 19 and Python with
`python-chess`. The scorer compares each experimental arm with the
frozen v34 report worker using the same position and exact engine frames.
For the first cohort, use `primary`. For the additional classical cohort,
use `classical-reserve`. This example uses the untouched puzzle reserve.

```powershell
$suite = 'benchmarks/decision-evidence/passed-pawn-interception'
$sample = 'puzzle-reserve'
$env:ASSET_INPUT = "$suite/$sample.json"
$env:ASSET_OUTPUT = Join-Path $env:TEMP "interception-before-$PID.json"
$env:ASSET_AXIS_ARM = 'baseline'
$proof = Join-Path $env:TEMP "interception-proof-$PID.jsonl"
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/strategic-asset-contrast/vitest.config.mjs
python -B "$suite/paired_probe.py" "$env:ASSET_INPUT" "$stockfish" "$proof"
python -B "$suite/score.py" "$suite/$sample-reference.jsonl" "$env:ASSET_OUTPUT" "$proof"
python -B "$suite/test_interception.py"
```

Set `$stockfish` to the full path to the engine executable before running
the example. The engine receipt pins the executable hash. Timings vary
between hosts.
