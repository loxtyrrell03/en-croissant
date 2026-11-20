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
```
