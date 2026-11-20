# Candidate selection from cached replies

The capture-order [verification diagnostic](../defender-capture-order/README.md)
verified 27 of 29 matched capture orders when it received the exact
question. The principal variation selector found only 11. This
experiment asks how much of the gap can be recovered from legal
continuations the app has already searched.

The [protocol](protocol.json) compares the principal selector, a
cached-reply fallback, priority for candidates supported by both
searches and legal expansion of an existing line's final capture.
They all use the same paired verification and one optional search
slot per board. The ordinary reply searches and root frame are
common inputs. The reference checks the competitive initial move,
competitive reply, the original defender and the two move orders
separately. Exact alternate questions are adjudicated separately.

On the earlier 144-game development set, the recorded-order scores
were 11/29, 17/29, 17/29 and 18/29 with zero false calls on 20 exact
controls. Optional search counts were 25, 40, 40 and 52. The cached
pool offered multiple choices on eight games. The legal expansion
raises search cost even when there is no meaningful alternative.

The [separate frozen sample](holdout.json) has 78 capture-order
challenges and 48 ordinary controls drawn from 1,935 eligible games
across 20 public classical events. The sampler excluded previous
tournament families, game prefixes and like-for-like mirrored
positions. See [source manifest](holdout.manifest.json) for the
time controls, exclusions and SHA-256 hashes.

## Reproduce

Run from the repository root using Python with `python-chess` and
Stockfish 19 matching the earlier bench's engine hash. The source
PGNs are unnecessary for analysis with the sealed move histories.

```powershell
$bench = 'benchmarks/decision-evidence/cached-capture-selection'
$base = 'benchmarks/decision-evidence/defender-capture-order'
python "$bench/test_selection.py"
python "$base/trials.py" app "$bench/holdout.json" $stockfish principal.json
python "$base/common_replies.py" principal.json $stockfish common.json
python "$bench/selection.py" common.json $stockfish selections.json
python "$base/trials.py" ref "$bench/holdout.json" $stockfish reference.json
python "$bench/report.py" review-questions selections.json reference.json extra-questions.json
python "$base/trials.py" ref extra-questions.json $stockfish extra-reference.json
python "$bench/report.py" report selections.json reference.json results.json extra-reference.json
```

These scores measure one position and move-justification mechanism.
The enriched questions cannot estimate whole-game incidence. Ordinary
controls measure additional searches and receive individual review
if a selector makes a new call.
