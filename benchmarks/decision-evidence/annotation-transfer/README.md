# Annotated classical decisions from an outside source

This study tests whether En Croissant gives evidence for the same chess
idea an outside annotation highlights. Position character, the exact
annotated move and the cause of a recorded mistake are separate questions.
A tactical motif elsewhere in the variation does not demonstrate coverage
of the annotated idea. The original tactical scanner is a limited proxy
for the first two questions. Its original mistake categories are scored
separately.

## Fixed selection

The [public annotated Candidates study](https://lichess.org/study/Y1yXP80U)
contains classical games from two sections. We freeze one annotated main
line move per game, use the Open section for development and reserve the
Women's section for transfer. The split measures transfer to different
games in the same published study. Keyword and annotation marks help sample
strategic, tactical, combined and mistake examples. They have no role as
reference labels. Related colour-normalised boards and previous game
prefixes are excluded where the supplied archives record them.

The study was also one source for the published ACT-Eval commentary
benchmark. Its linked repository returned 404 when checked. These are
our independently selected boards and review labels. The source prose
and variations are read locally and are not redistributed in this
repository. [Paper and source description](https://arxiv.org/html/2608.04240v1)

## Review and measurement

Read the original study note and both sets of Stockfish continuations
before inspecting detector outputs. Score each axis as present, absent
or unresolved, with an exact comparison when the claim depends on the
reply. Use the same three-scope definitions as the earlier
[classical review](../current-classifier-audit/classical-review-protocol.md),
with the annotated move as the exact move instead of the engine leader.
An omitted move is a coverage miss when its reference is positive.
An alternate plan or equal exchange can appear in an annotation without
establishing a tactic. A move in an opening plan may be positional
while the recorded decision is a sound move with no mistake mechanism.

Store hashes for the selected FENs, annotated source and captured engine
frames. Report tactical, positional and mixed agreement by question,
target-move availability and the novel reason when an explanation
improves. Treat published comments as evidence about the relevant theme,
and use independent deeper lines to check causal attribution.

## Reproduce the selection and engine inputs

Use the source export with comments and variations from Lichess.
Save the prescribed PGN locally and check its hash against the
[manifest](selection.manifest.json). Run `freeze.py PGN SELECTION NOTES
--exclude PRIOR_FILES...` to regenerate the selected boards and the
local-only prose packet. Exact PGN positions and moves are already
stored in [selection.json](selection.json).

```powershell
$source = 'benchmarks/decision-evidence/annotation-transfer/selection.json'
$frames = 'benchmarks/decision-evidence/current-classifier-audit/classical-frames.py'
python $frames app $source $stockfish app.json
python $frames reference $source $stockfish deep.json --app-frames app.json
```

## Baseline and exact-move availability

Of 56 annotated moves, the v62 report makes 44 available as
exact choices even though the paired search has all 56. The
prototype feeds the otherwise unavailable move's paired line
back through the exact-move assessor with no additional engine
search.

| Reserve question | Reviewed positives | Original | v62 | v63 |
| --- | ---: | ---: | ---: | ---: |
| Tactical position | 9 | 4 | 5 | 5 |
| Positional position | 24 | — | 4 | 4 |
| Mixed position | 7 | — | 0 | 0 |
| Tactical exact move | 3 | 2 | 2 | 2 |
| Positional exact move | 14 | — | 3 | 4 |
| Mixed exact move | 2 | — | 0 | 0 |
| Tactical mistake | 4 | 1 | 1 | 1 |
| Positional mistake | 2 | 1 | 0 | 0 |

All 12 missing moves become inspectable. Nine remain unclear.
Three receive positional observations, including one agreed
positive and two unresolved references. The verified improvement
is `h4` fixing the h4–h5 pawn lock. It remains an evaluation
setback against the stronger alternative. The position and
mistake questions stay unchanged. The prototype adds no calls on
reviewed negatives. There are no definite position negatives in
this reserve, so it cannot estimate position precision.
[Reviewed labels](reference.json) · [Complete prototype scores](prototype-results.json)

Decision Evidence v63 stores the supplemental played move
outside the engine shortlist. Only the existing move selector
lists it, labelled **Played move**. Move-selection and
mistake comparisons share the already scored exact line.
Replays of 56 new and 124 previously captured requests preserve
the original candidate, position and mistake reports apart from
the report's version number. The 124 requests expose 10 further
recorded choices, with two positional and eight unclear.
`verify_release.py` compares those v62, v63 and prototype replays.
[Release replay receipt](release.json)

The pinned panel passed at 320, 390 and 900 pixels. The isolated
Windows build at `46c70780` used real Stockfish 19 and displayed
the `h4` pawn lock when selecting **Played move**, alongside a
separate estimate of 0.86 pawns lost and an unclear cause. The
promotion diversion explanation also passed on the same build.
[Windows receipt](windows.json)

## Links to the earlier benchmarks

On the earlier 72 classical games, v62 with the one already
verified optional capture-order comparison explains one of
17 positive mixed positions and one of seven mixed exact
moves. The earlier v57 replay explains neither. The cached
Woodpecker comparison gives v62 20/35 tactical, 6/24 positional
and 2/9 mixed exact-move positives. The original tactical
proxy detects 7/35. Those boards informed earlier development.
Only the aggregate counts are shared here.
[Retrospective results](retrospective.json)

The Candidates review gives two useful priority cases. The
`Ne7+` discovered check is detected, while its purpose of
retaining the e6 pawn structure is absent. The defender's
`g5` king-flight resource against the b-pawn remains unclear on
both axes. Conversely, the technical `Kxg4` conversion is called
tactical because it wins a loose pawn. These are distinct gaps
in attribution. The new selector does not change them.

`mixed_followup.py` re-searches the exact alternatives at 4.8
and 8 million nodes per request. Both budgets prefer `...Ne7+`
over `...exd5` and show the e6 structure surviving the exchange
of the rook on d5. In both leading lines White eventually plays
`Nxe6`, so the structure is temporary. Both `...g5` and
`...g6` vacate g7. The leading independent replies support an
earlier `...Kg7` after `...g5` while White's b-pawn is still
stopped short of promotion. The lines establish the timing
difference. They cannot isolate how much of the evaluation
difference comes from king mobility. These two examples are
already reviewed and are diagnostic probes.
[Exact searches](mixed-followup.json)

## Frozen neural models on the outside annotations

The earlier Maia-3 ranking methods and controls are refit on their
original 259 reviewed classical positions using the original settings.
The pretrained board encoder stays fixed. All 56 Candidates games
are outside that labelled fit, with disjoint game IDs, event IDs and
colour-normalised root boards. The Candidates positions also postdate
the game's training window stated by the model's authors.
[Original protocol](../maia-branch-probe/position-protocol.json) ·
[Maia-3 model card](https://huggingface.co/UofTCSSLab/Maia3-5M)

The models rank positions on each axis where the v63 classifier has
no supported answer. Each section gets one search nomination per four
unresolved positions, rounded down. Every method sees the same three
Stockfish lines. Each cell counts reviewed positives in that queue.
Uncertain references consume a slot. The reference has no definite
position negatives, so this estimates review yield only. These are
neither classifier precision measurements nor confirmed explanations.

| Position search ranker | Tactical, 11 slots | Positional, 11 slots | Mixed, 12 slots |
| --- | ---: | ---: | ---: |
| Stockfish evaluation gap | 5 | 8 | 6 |
| Legal-line boosted tree | 5 | 11 | 6 |
| Small legal-line network | 5 | 10 | 3 |
| Maia move predictions plus legal lines | 6 | 10 | 6 |
| Maia board representation plus legal lines | 4 | 9 | 4 |
| Maia continuation representation plus legal lines | 4 | 10 | 5 |

The best neural arm ties existing controls on mixed review and
selects one more tactical positive in the Open section than the
strongest simpler controls. Its tactical yield ties them in the
Women's section. The earlier
criterion of two more reviewed positives with improvement across
two event groups is unmet. Learning mixed status directly gives
5/12 for logistic regression, 4/12 for the small network and
3/12 for the Maia board representation. The two sections share
one publication. Eleven reviewed mixed positives and a single
reviewer limit any claim about generalisation. Zero extra
Stockfish nodes were used. A Maia CPU batch took about 50 ms per
position, excluding feature preparation and model load.
An independent rerun of the same inputs reproduced every ranking
and count.
[Complete rankings](maia-transfer.json)

Use `maia_inputs.py APP_FRAMES REFERENCE V63_WORKER SAMPLES REPORTS`
to prepare the transfer format. Then run
`../strategic-continuation-contrast/neural-transfer.py` with the same
checkpoint and training inputs specified in
[its reproduction instructions](../strategic-continuation-contrast/README.md).
Supply the two generated paths to `--transfer`. The runner verifies
the original training and checkpoint hashes. The annotation adapter
verifies the frame hash, exact moves and worker version.
