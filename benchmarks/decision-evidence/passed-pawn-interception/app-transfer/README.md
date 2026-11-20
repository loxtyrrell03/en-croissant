# Costly passed-pawn trades in Decision Evidence

Decision Evidence can now explain a played mistake when two Stockfish
searches show the same passed pawn costing material to stop. Both
stronger lines need to show how to take that same pawn economically.
If it stays below the seventh rank, the verifier follows the available
line through the later capture, the recaptures and the next reply.
It checks the move and the recorded history together when a game
history is supplied.

In Savchenko–Kiriakov, `69...Bb7 70.Rc7 Bf3 71.b7 Bxb7
72.Rxb7` gives up a bishop for a pawn. After `69...Bf3` the pawn
stays on b6 until Black can play `...Nxb6`. The report shows the
2.3-point cost of the exchange separately from the engine evaluation
loss. Open **Show evidence** under **What Bb7 missed or allowed**
to see both lines. [Round 5 games](https://lichess.org/broadcast/1st-berjaya-global-chess-open-2026-masters/round-5/5GT2hWqT)

## What changed during validation

1. The initial short comparison recovered four previous unclear
   puzzle cases and missed the five annotated classical references
   in the first replay.
2. Extending the comparison through existing recaptures exposed an
   arithmetic error. In Groningen, `Bxa8 Rxa8` spends a bishop on
   a pawn just as `Bxa7 Rxa7` does. The first extension counted the
   promoted piece as a full material gain even though the pawn
   acquired that value during the same line. The final comparison
   charges the pawn's advances and promotion to the same trace.
   The original reference remains available alongside the
   [post-output correction](adjudication.json).
3. The stronger Berjaya lines held the pawn below the seventh rank
   and took it later. The corrected verifier can finish this
   evidence without allowing a late interception of a pawn that
   had already reached the seventh. A separate run using the app's
   node budgets had two exact paired lines at depth 15 and two
   separately corroborated replies at depth 21. The reply checks
   supply independent score and continuation evidence. The
   ordinary budget now reproduces the diagnosis.
   [Exact game and search fixtures](examples.json)

## Results

| Matched sample | Decisions | Reviewed mechanism positives | Reviewed negatives | New confirmed diagnoses | New false calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier puzzles and classical controls | 333 | 48 | 128 | 4 | 0 |
| First annotated classical selection, after adjudication | 126 | 4 | 71 | 0 | 0 |
| Summer classical selection, used to refine the defence | 88 | 4 | 53 | 1 | 0 |
| Late classical reserve | 75 | 1 | 45 | 0 | 0 |

The result adds one reviewed classical diagnosis and four puzzle
diagnoses across 622 matched replays. Forty-one uncertain and 227
ineligible inputs are outside the binary counts. The Berjaya case
guided the containment and adaptive-depth revisions. The later
75-game sample checks the final rule on other games. It includes
one confirmed case in Arad where the stronger lines use rook play
and pawn counterplay without taking the original passed pawn.
The new rule abstains there. Median worker time for the late reserve
was 48 ms before and 43 ms after with matched cached frames.
The timing excludes Stockfish and rendering. [Results](results.json)

Cases are classical actual moves or real game extracts from the Lichess
puzzle database. The first classical selection prioritizes broadcast
evaluation losses around advanced passers. The two later selections use
separate games from different events. A single reviewer used an
independent 2.4-million-node reply for each choice plus a
1.65-million-node restricted defence where a candidate interception
needed clarification. Controls can contain other tactical mechanisms.
The comparison scores only newly supported explanations for the
specified pawn mechanism. [Sampling and engine receipts](protocol.json)

The stronger choice may deal with the threat through checks,
blockade, a different promotion race or a trade on another file.
When the available lines cannot show a cheaper capture of the same
pawn, the new rule abstains. Position character, candidate-move
assessments, positional mistake evidence and evaluation losses
match in the replays. No extra Stockfish searches run. The source
panel compiled and expanded both lines at 320, 390 and 900 pixels
with fixed engine frames. Native installation is unverified.

## Reproduce

Run from the repository root. Use `annotated`, `summer` or
`late-reserve` in the example below. The configuration loads the
decision worker and the changed source from the selected Git revision.
Use a fresh output filename for each run.

```powershell
$suite = 'benchmarks/decision-evidence/passed-pawn-interception/app-transfer'
$set = 'summer'
$env:INTERCEPTION_INPUT = "$suite/$set.json"
$env:INTERCEPTION_REV = '07b48ba8'
$env:INTERCEPTION_OUTPUT = Join-Path $env:TEMP "pawn-before-$PID.json"
node node_modules/vitest/vitest.mjs run --config "$suite/vitest.config.mjs"
$before = $env:INTERCEPTION_OUTPUT
$env:INTERCEPTION_REV = 'HEAD'
$env:INTERCEPTION_OUTPUT = Join-Path $env:TEMP "pawn-after-$PID.json"
node node_modules/vitest/vitest.mjs run --config "$suite/vitest.config.mjs"
python "$suite/score.py" "$before" "$env:INTERCEPTION_OUTPUT" "$suite/$set-reference.jsonl"
```
