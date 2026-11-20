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

## Transfer results

The deeper review confirmed 26 recorded comparisons, scored nine as
harmless and left 43 indeterminate. It also reviewed five different
capture orders that the cheap selectors proposed.

| Selector | Exact recorded comparisons | Missed exact comparisons | False calls on nine controls | All confirmed calls | Indeterminate calls | Optional searches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Principal variation | 10/26 | 16 | 0 | 12 | 2 | 20 |
| Cached reply fallback | 13/26 | 13 | 0 | 17 | 3 | 29 |
| Agreement priority | 13/26 | 13 | 0 | 17 | 3 | 29 |
| Legal expansion | 13/26 | 13 | 0 | 17 | 3 | 36 |

None of the four methods added a search in the 48 ordinary controls
in this sample. The cached arm used 34.1M optional nodes, versus 23.8M
for the principal arm and 42.7M for legal expansion. Only five
boards had multiple cached nominations. A learned ranker choosing
among these same lines has few opportunities to improve the result.
The broader research question is whether learning can nominate
useful legal alternatives that the available engine lines omit.
[All candidate outcomes](results.json)

## Application path

Decision Evidence keeps a principal variation proposal when the reply
also has separate score support. Otherwise it looks in the
competitive cached replies. A separately paired search can exclude a
weaker root. The selected comparison must reproduce the exact guard
action, retain the original target and agree with both the root and
reply scores. The result names the opponent response it applies to.
Position and move explanations can use this evidence. Played mistake
assessment is independent.

The stricter implementation replays the same 126 cached frames,
adds 15 optional comparisons and supplies nine new position and
nine new move explanations. All nine match deeper confirmations.
Four of the nine required the cached reply. None of the 48 ordinary
boards receives a query. The played mistake reports agree with the
baseline in all 126 cases. This replay supplies the cached input to
the actual assessor. [Application replay](application.json)

In Amager, after `...Qd4 bxc3`, Black needs `...Qxc5` before taking
on c3. The immediate `...Rxc3` gives White `Qxd4`, taking the piece
that was about to remove the defender. [Game broadcast](https://lichess.org/broadcast/amagers-100ars-jubilumsturnering-open/round-6/L3aezZWu/YweFrqkr)

The isolated Windows build reproduced the Amager explanation using
Stockfish through the normal Tactics panel. The Ganja challenge
remained unclear at the normal live search budget. The fixed-budget
replay verifies the capture order after
the separate `...Rb8` reply. The renderer passed at 320, 390 and 900
pixels, including opening and closing both evidence sections.
[Windows and renderer receipt](windows.json)

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

To reproduce the application replay, capture the baseline worker on
`common.json` with `DECISION_AUDIT_REVISION=7e1524d5` as in the
[capture-order benchmark](../defender-capture-order/README.md). Then
run the assessor in two stages so Stockfish only receives the exact
questions it selected:

```powershell
$env:CAPTURE_REPLAY_INPUT = 'common.json'
$env:CAPTURE_REPLAY_BASELINE = 'baseline.json'
$env:CAPTURE_REPLAY_OUTPUT = 'questions.json'
node node_modules/vitest/vitest.mjs run --config "$bench/runtime.config.mjs"
python "$bench/replay.py" selections.json questions.json $stockfish probes.json
$env:CAPTURE_REPLAY_PROBES = 'probes.json'
$env:CAPTURE_REPLAY_OUTPUT = 'application.json'
node node_modules/vitest/vitest.mjs run --config "$bench/runtime.config.mjs"
```

Use the [isolated Windows workflow](../native-desktop/README.md) for
the live cases. The source render test uses the recorded inputs:

```powershell
node "$bench/verify-panel.mjs" $decisionPlaywright $chromeExecutable
```

These scores measure one position and move-justification mechanism.
The enriched questions cannot estimate whole-game incidence. Ordinary
controls measure additional searches and receive individual review
if a selector makes a new call.
