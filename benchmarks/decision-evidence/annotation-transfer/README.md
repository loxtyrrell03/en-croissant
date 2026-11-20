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
repository. [Paper and source description](https://arxiv.org/html/2608.04240v1#A3.SS1)

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
