# Teaching a model to distinguish a durable outpost from a transient one

This study tests whether paired engine searches can supply a reliable
training label for one kind of mixed mistake. We look for the same
opposing knight or bishop winning a pawn and then retaining a
pawn-supported square in both played lines. The two better-move lines
must avoid that square through a comparable, settled material window.
The stricter verifier checks for a legal equal or profitable exchange
against the piece and keeps the positional interpretation separate from
the tactical evidence.

## Results

| Replay | Current worker | Experimental worker |
| --- | --- | --- |
| 17 archived mixed mistakes used for development | 1 mixed verdict | 2 mixed verdicts |
| 143 fresh classical games, one position per game | 143 reports | All 143 reports agree with the current worker |
| Full archive with 1,050 valid reports | Reference | One change, confined to the positional evidence of the mixed development example |

The geometry screen nominated one new case. The stricter replay
rejected it, and independent Stockfish analysis confirmed the reason.
Thirty-five fresh games were excluded from deeper review because the
played move led the preview or the matched pair showed no loss of at
least 0.60 pawns. The 108 independently searched cases produced no
confirmed new instance of the narrow training label. These were
geometry-enriched positions from 54 classical broadcasts across the
full sample. The selection was disjoint by game and position from the
development material, and several event families recur. These results
cannot measure overall positional or mixed recall.

- **Development positive.** After 38.Bf6 Bxf6 39.exf6 Nxf6, Black's
  knight has taken the original e5 pawn. It lands on e4 after
  40.Nxg6, supported by d5. The app-budget lines and the independent
  primary reply keep it there. After 40.Nxg6 the deeper search ranks
  ...Ne4 108 centipawns ahead of the next alternative at the same
  completed depth. Both compared 38.Bxe7 lines avoid the outpost
  over the matched window. The 108 centipawns compare continuations
  at the same board. They cannot isolate the evaluation value of
  the knight's square. [Molinari vs Foti](https://lichess.org/broadcast/5-halloween-chess-festival/round-4/lYZ5MUfg/mV8XrGY1)
- **Fresh negative.** In the Bundesliga game, 22...f5 23.Bxc4+
  Kh8 24.Bd5 wins a pawn and puts White's bishop on a pawn-backed
  square. Both app-budget lines leave it there. The deeper primary
  reply trades the bishop with 24...Bxd5 25.Rxd5. Pawn loss stays
  in the tactical report. [German Bundesliga round 6](https://lichess.org/broadcast/german-bundesliga-202627-schachbundesliga/round-6/6k62uFr2)
- **Related mechanisms.** In New Zagreb the knight reaches d6 in
  two deeper lines, once via a capture on e4 and once via a quiet
  move to e4. The lines differ materially. These cases need a
  review of piece activity and the tactical alternatives before
  they can label a strategic cause. [Reviewed continuations](reference-examples.json)

The experiment stays offline. It changed one report already used
in development and added zero in fresh play. Training a model on
this label would mainly teach it from geometric proxies. The next
credible neural comparison would use many reviewed exact-move
alternatives and contrast independently verified threats and strategic
effects at the same board. Prior published neural results concern
rankings for further review. They do not establish verified improvement
in the app. [Prior Leela comparison](../leela-counterfactual-probe/README.md)

## Reproduction

The snapshot contains only public broadcast positions and saved
analysis. A snapshot source URL can point to the event's representative
round if the PGN lacks a game link. The examples list the verified
source where available. The checked runner loads the application from the revision
in [protocol.json](protocol.json), overlays the proposal in memory and
leaves the application checkout alone. For the focused regression
tests, run the two arms with OUTPOST_INPUT unset. For the full replay,
run from the repository root in PowerShell.

```powershell
$suite = 'benchmarks/decision-evidence/outposts-after-exchanges'
$env:OUTPOST_INPUT = "$suite/reserve.json"
foreach ($arm in @('baseline', 'candidate')) {
    $env:OUTPOST_ARM = $arm
    $env:OUTPOST_OUTPUT = Join-Path $env:TEMP "outpost-$arm-$PID.json"
    node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
python "$suite/score.py" (Join-Path $env:TEMP "outpost-baseline-$PID.json") (Join-Path $env:TEMP "outpost-candidate-$PID.json") (Join-Path $env:TEMP "outpost-compare-$PID.json")
```

Stockfish 19 used 600,000 nodes for the root preview, 1.2 million
for the matched pair and 900,000 per reply. The independent review
uses 1.8 million per reply search and two completed variations.
The experimental worker does no extra engine work. Cached worker
timings are available in [results.json](results.json).

- To regenerate the independent review, run `deep-review.py`
  with a fresh output directory, the Stockfish executable and
  `reserve.json`. It uses python-chess and the repository's
  completed-variation collector. `triage.py` prints relevant
  positions from that output for human review.
- To remake the sample with the retained local public PGNs,
  set PYTHONPATH to `benchmarks/decision-evidence/passed-pawn-interception`.
  Run `sample.py` with the local classifier research folder and a
  fresh output directory. Run `engine.py` with the output
  directory, pinned Stockfish executable and prefix `classical-`.
  Inspect the sample manifest for the per-event counts.
- To repeat the retrospective comparison, use the private archive
  inputs specified in the [cross-scope audit](../cross-scope-audit/README.md)
  and check against the archive hash in the protocol.
