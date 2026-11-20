# Independent transfer of the matched-reply explanation

The prior reserve was used to choose this candidate. The candidate
accepts a quiet reply that is good after the played move and bad
after the better move. It requires two legal searches of the played
move to record a material loss from the aligned pieces, with a
defender turn immediately after the capture. The exact reply after
the better move must break that alignment and preserve material at
the matched horizon. The result applies only to the tested reply.

The worker candidate limits nomination to positions where both
played continuations already show the local material loss. It then
uses a cached exact reply after the better move when one exists.
Otherwise it needs one restricted engine analysis. The older
geometry-only nomination asked for that comparison in positions
where a recapture, capture elsewhere, or legal defence already
ruled out a local payoff.

## Transfer protocol

The [transfer selection](transfer.json) freezes one decision per game
from event families outside the original shared-ray experiment.
Selection uses the original played alignment and recorded capture
strata plus ordinary controls. Source files and overlapping previous
inputs are identified by hashes. A source's recorded capture is an
enrichment signal. It contributes nothing to the candidate's proof.
[Public broadcast exports](https://lichess.org/broadcast/help)

Run the previously fixed Stockfish budgets and review the deeper
packet before checking any candidate or app verdict. The reference
endpoint is material lost from an original aligned piece as a
consequence of the shared reply. Mark inconclusive cases separately.
Report exact matches, false and unresolved calls, missed reviewed
cases, how often a correct explanation improves the existing one,
and the number of cached and restricted continuations. Existing
mistake labels provide the worker baseline. A later line tactic
cannot count as an explanation of the earlier material loss.

## Transfer results

There are 119 classical decisions from 32 event families, with 39
recorded-capture challenges, 48 alignment challenges and 32 ordinary
controls. One engine-assisted reviewer checked 40 questions at higher
search budgets. Four were positive, 32 negative and four unresolved.

| Method | Correct direct explanations on 4 positives | False calls on 32 negatives | Calls on 4 unresolved |
| --- | ---: | ---: | ---: |
| Existing worker | 1 | 0 | 0 |
| Two local exchanges and same-reply comparison | 3 | 0 | 0 |

- `Rd1` allows `...Bb3` to attack the queen and line up the rook
  behind it. `...Bxd1` wins the exchange in both played continuations.
  `Ne3 Bb3 Qd3` preserves the material.
- `Nc2` allows `...Rb2`. The promotion on a1 diverts the knight and
  the rook behind it falls to `...Rxe2`. After `Be5`, the same reply
  can be met by `Bxb2`.
- `Qc2 Bb3` was already identified as tactical. The comparison adds
  the exchange outcome against the same `...Bb3` after `Qg4`.

The fourth reviewed positive, `Nd8 Rd3`, remains outside the
candidate's 100-centipawn root loss requirement. The limited sample
does not estimate recall across all motifs. The candidate reused one
cached reply and nominated three restricted searches, representing
3.0 million nodes in the completed frames. A reply nominated by the
old shared-reply method is requested only once in the app.
[Blind reference](transfer-reference.json) · [Scores and proof lines](transfer-results.json)

## Integration

Decision Evidence v62 uses this comparison only for the recorded
played mistake. It keeps other engine-supported reasons and puts
the matched comparison first, with the played and better
continuations in the existing evidence control. A separate
bounded legal proof retains priority.

The committed worker at `cd14819e` reproduces all three
explanations on the same frames. Only the reported mistake changes.
Both earlier unclear mistakes become tactical, and the third gains
the comparison while keeping its original reason. Evaluation losses,
other assessments and report availability agree with v61. Across
1,875 archived requests, all 1,869 available reports agree apart
from the version. One of the three restricted probes is incremental
over v61. The other two share existing requests. We verified the
rendered panel at widths of 320, 390 and 900 pixels and ran 43
targeted tests. [Integrated worker and cost receipt](transfer-release.json)

The isolated Windows build of `cd14819e` passed both new
examples with live Stockfish 19, in 12.4 and 12.9 seconds
respectively. The existing rear-piece trade regression passed in
13.6 seconds. The isolated type check passed. The test opened
the visible mistake panel and verified the played and better
lines. [Windows receipt](transfer-windows.json)

The original Chilean `Bh4 Qh7` development case also changes
from unclear to tactical on a separate replay. The independent
lines lose either the knight on h5 or the bishop on h4. The cached
`Qc1 Qh7 Nxf6` line keeps the material. This development readback
is outside the transfer totals. [Compared lines](chile-development-replay.json)

## Reproduce

From the repository root, use the same python-chess environment and
Stockfish binary as the [original experiment](README.md).

```powershell
$bench = 'benchmarks/decision-evidence/shared-ray-mistakes'
python "$bench/capture.py" "$bench/transfer.json" reserve app $stockfish transfer-frames.json
python "$bench/verify_exact.py" $stockfish transfer-review.json transfer-frames.json
$env:DECISION_AUDIT_REVISION = '46101c2f'
$env:RAY_INPUT = 'transfer-frames.json'
$env:RAY_OUTPUT = 'transfer-candidate.json'
node node_modules/vitest/vitest.mjs run --config "$bench/replay.config.mjs"
python "$bench/score_transfer.py" transfer-frames.json "$bench/transfer-reference.json" transfer-candidate.json transfer-baseline.json transfer-results.json
```

Use the archived worker replay in the [original experiment](README.md)
with revisions `46101c2f` and `cd14819e` for the before and after
reports. Run `verify_transfer_release.py` with those two transfer
reports, the candidate report, the old archive replay and the
corresponding new archive files. With `RAY_RELEASE=cd14819e`,
`verify-transfer-panel.mjs` takes Playwright's `index.mjs` and a
Chrome executable.
