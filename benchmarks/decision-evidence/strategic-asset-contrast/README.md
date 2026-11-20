# Passed pawns and supported minor pieces after an exchange

This experiment tests a gap in the played-move report. The engine can see
a concrete tactical consequence while missing a separate positional
effect. In the archived Asian Disabilities Championship game, `Qd2`
allows `...Ne4`, forking the queen and rook. The knight also keeps e4 after
the rooks exchange, supported by d5. In the Arco Open example,
`d5 exd5 cxd5` creates a passed pawn from c4. The current report leaves that
mistake unclear. These are development examples.
[Board positions and engine frames](examples.json)

## What we tested

Both variants replay the scored choice and the played move, together
with a separate Stockfish reply after each. A report requires the same
original piece and square to persist for four plies in the two relevant
lines. The other decision must avoid a comparable asset. The compared
material balances must be within about one pawn when the window ends.

The linked variant also asks how the original decision enabled or
prevented the feature. It can follow a pawn through an exchange on the
same square or see the stronger move remove the original pawn directly.
For an outpost it checks the entry, pawn support and whether the piece
can be taken at a gain. The broader variant uses the recurring feature
without that link. Both variants use the existing engine output. The app
worker was replayed with the linked variant as an optional source of
positional evidence when it had none established. An existing tactical
diagnosis could then become mixed.

The first linked iteration missed all three positives in the initial
cohort. It required the subject pawn to survive in the comparison and
missed a delayed recapture. We revised those two cases and froze the
variant before opening the prediction outputs for the two subsequent
cohorts. Those cohorts come from fresh classical events with
game- and board-disjoint positions. The sample is enriched for sustained
structures and includes quiet and exchange controls.
[Sampling, engine budgets and freeze hashes](protocol.json)

## Results

| Classical cohort | Reviewed positives | Reviewed negatives | Broader variant true / false | Linked variant true / false | Current worker to linked worker, reviewed positives diagnosed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial, used to revise the link | 3 | 18 | 2 / 0 | 2 / 0 | 0 to 2 |
| First held-out, 135 games | 2 | 21 | 1 / 0 | 1 / 0 | 0 to 1 |
| Second held-out, 170 games | 3 | 18 | 1 / 1 | 0 / 0 | 0 to 0 |

Ten uncertain reviews and 344 excluded rows across the three cohorts
are outside the binary denominators. Most exclusions occur because
the played move leads the preview or the paired engine search finds
no confirmed loss of at least 0.60 pawns. The review uses an independent
1.5-million-node reply search, legal replay and one reviewer. The
sample measures these two mechanisms and does not estimate general
positional or mixed accuracy.
[Initial review](initial-reference.json),
[first held-out review](replication-reference.json),
[second held-out review](reserve-reference.json),
[comparison output](results.json)

The lone held-out addition is the Calvia game. `...dxc4` moves Black's
d5 pawn off its file, then `d5 exd5 exd5` leaves White's original e4
pawn passed. `...bxc4` retains the d5 blocker in both searched lines.
Across the two held-out sets the stricter variant adds one confirmed
explanation of five with zero false positives across 39 negatives.
The prespecified minimum was two confirmed additions, so neither trial
has been integrated.
[Game and position](https://lichess.org/broadcast/23rd-calvia-chess-festival-2026/round-7/1bxtyo5f/jWDuCUxV),
[verified case frame](examples.json)

Three different issues limited transfer. In the NZ South Island
Championship, `...Kh8 Nxd6` leaves the d5 pawn passed in both weaker
lines. The link rule has no way to attribute the knight's gain after
this king move. In the Dutch league game, the deeper reply sees the
`...d5–d4` plan create a passer from c5. The app-budget reply chooses a
line without it. In the Atyrau game, `...bxa6` directly stops the passed
b7 pawn seen after `...h3 axb7`, but the app-budget reply after
`...bxa6` completes depth 15, one below the proof minimum. The broader
rule also calls a passed f6 pawn after `...Rab8` in the Romanian league.
The independently searched reply varies before that pawn reaches f6.
[Exact continuation and depth records](reserve.json)

In the matched experimental worker replays, position character,
candidate move assessments, tactical evidence and evaluation losses
agree. The archived replay adds three examples, including one mixed
case. The positional interpretation remains heuristic even where the
square, piece identity or pawn support is a verified board fact.
Median replay time on the two held-out sets ranged from 36 to 42 ms per
request, with roughly 1 ms or less difference between the arms. There
were no extra engine searches in the experimental app path.

## Reproduce

From the repository root, set `ASSET_INPUT` to `replication.json` or
`reserve.json` in this directory. Run the replay three times with
`ASSET_AXIS_ARM` set to `baseline`, `candidate` and `proofs`, setting
`ASSET_OUTPUT` to a fresh JSON filename each time. The runner loads the
frozen product revision from Git and overlays the experimental code in
memory. It never edits the product. The scorer verifies the full
comparison and flags non-positional changes. This example uses PowerShell.

```powershell
$suite = 'benchmarks/decision-evidence/strategic-asset-contrast'
$env:ASSET_INPUT = "$suite/reserve.json"
foreach ($arm in @('baseline', 'candidate', 'proofs')) {
    $env:ASSET_AXIS_ARM = $arm
    $env:ASSET_OUTPUT = Join-Path $env:TEMP "asset-$arm-$PID.json"
    node node_modules/vitest/vitest.mjs run --config "$suite/vitest.config.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Replay failed for $arm" }
}
python "$suite/score.py" "$suite/reserve-reference.json" `
    "$env:TEMP/asset-proofs-$PID.json" "$env:TEMP/asset-baseline-$PID.json" `
    "$env:TEMP/asset-candidate-$PID.json"
```
