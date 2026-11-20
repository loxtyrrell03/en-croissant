# Strategic roles of an original passed pawn

The classifier already has separate tactical and positional dimensions.
The earlier [three-scope audit](../current-classifier-audit/classical-results.md)
found that a position already containing a strategic asset often left
the positional dimension unsupported. A feature on the board is
insufficient for explaining the exact move. This experiment checks
what the players do with the original pawn across distinct, legal
continuations.

The same pawn must already be passed and at least on its fifth rank.
Actual advances, captures and blockades are traced by original piece
identity. The compared continuations must be viable from separate
searches. The stricter arm rejects transpositions before the event
and checks that a move actually participates in the resulting plan.
The position report can compare different initial choices. The
exact-move report requires the same initial choice and an identified
contribution in both lines. Static presence and repeated observed
events supply two comparison arms.

## Frozen test

The [holdout](holdout.json) covers 72 advanced-pawn challenges and 48
independently sampled ordinary controls from 23 event families.
It reuses public PGN source copies from the earlier unseen-reply
experiment, selecting different games and mirrored boards. Those
families are separate from the earlier strategic development
examples named in the [manifest](holdout.manifest.json).
The [protocol](protocol.json) fixes both search depths and selects
36 blind review cases before the predictions are examined. Known
and unknown references are kept separate.

The Chilean `45...Bf2` example is strictly development. After
`46.Rh5`, Black must remove the bishop before `...Rxb6`. After
`46.Bg5`, the original bishop no longer defends b6. White can
recapture on b6 with the rook, when the bishop on f2 takes back.
This is why the quiet move contributes to controlling the same
passed pawn in both lines. The tactical statement concerns the
capture order after `Rh5`. The strategic interpretation concerns
why the pawn matters across replies.
[Previously checked deeper lines](../unseen-legal-replies/mixed-readback.md)

## Before and after review

The initial blind packet has 14 positive position references and
18 known negatives for this pawn mechanism. The exact-move packet
has four positives and 23 known negatives. Four position labels
and nine move labels are indeterminate.

| Evidence | Position correct / false on known cases | Exact move correct / false on known cases |
| --- | ---: | ---: |
| Original advanced pawn is present | 14 / 6 | 4 / 11 |
| The same original pawn is used in two lines | 5 / 0 | 3 / 1 |
| Different routes and verified participation | 3 / 0 | 1 / 0 |
| Direct blockade and supported handoff added | 4 / 0 | 3 / 0 |

The first three rows use the original frozen rule. The final row
was developed after reading its misses. It recognizes a blockade
placed by the root move when it holds after different replies.
It also recognizes a new piece taking over on the same square
when the root piece stays behind and can legally defend it.
In the f6-pawn example, `...Rf8` clears f7 for `...Nf7` while
the rook continues to protect f7. The move itself has a concrete
strategic contribution. [First review](blind-reference.json) ·
[Initial results](results.json) · [Revision](results-handoff.json)

The revised rule was then tested on a [second sample](transfer.json)
of 48 unshared games from 18 separate event families. The 18-case
[blind packet](transfer-reference.json) has six definite position
positives and eight negatives. The revised rule identifies two
positives with no calls on the eight negatives. Both explanations
repeat at higher depth. This packet contains no definite
exact-move positives, so the revision's exact-move recall remains
open on independent data. [Transfer results](transfer-results.json)

## Application readback

The worker adds this evidence only to a position or exact move
whose positional explanation is still unsupported. A position's
strategic role can span different root moves. An exact-move
explanation needs two replies to that same move. Stockfish's
legal lines support the explanation, which appears as a strategic
interpretation because the lines do not quantify the pawn's
individual share of the evaluation.

On the primary 120 games the actual worker adds seven position
and five exact-move explanations. Three position additions and
two exact leading-move additions are checked positives in the
blind labels. The remaining scope and pawn attributions are
unreviewed or indeterminate, including one explanation of a
different move from the one the packet reviewed. The independent
48 games add two reviewed position explanations. There are no
known contradictions. [App replay on 120 games](initial-runtime-receipt.json) ·
[App replay on 48 games](transfer-runtime-receipt.json)

An additional replay on the earlier 72-board audit supplies the
same v59 tactical evidence to both workers. This changes
`...Bf2` from tactical to mixed in the position and exact move.
It is the only changed report on that audit. Played-mistake
reports and tactical dimensions match across all 240 replays.
Both layers reuse cached Stockfish lines, with no added search.
[Earlier audit replay](broad-runtime-receipt.json)

## Reproduce

Use Python with python-chess and the Stockfish 19 executable used in
the [capture-order benchmark](../defender-capture-order/protocol.json).
The sealed positions contain the full game prefixes. The raw
public exports are needed only for reconstructing the sample with
`freeze_passer.py`, using the manifests and exclusions.
[python-chess legal board API](https://python-chess.readthedocs.io/en/stable/core.html)

```powershell
$bench = 'benchmarks/decision-evidence/passer-role-contrasts'
python "$bench/test_pawn_plans.py"
python "$bench/gather_frames.py" app "$bench/holdout.json" $stockfish app.json
python "$bench/gather_frames.py" deep "$bench/holdout.json" $stockfish deep.json
python "$bench/blind_packet.py" app.json deep.json $reviewDirectory
python "$bench/score_plans.py" app.json deep.json "$bench/blind-reference.json" baseline.json first-results.json
python "$bench/score_plans.py" app.json deep.json "$bench/blind-reference.json" baseline.json updated-results.json --blockade-handoff
```

To reproduce the application comparison, use the
[committed worker baseline](../current-classifier-audit/replay.config.mjs)
with `DECISION_AUDIT_REVISION=893c9234` and `INTERFERENCE_MODE=archive`.
Then run the current worker with the same app frames:

```powershell
$env:PAWN_REPLAY_INPUT = 'app.json'
$env:PAWN_REPLAY_BASELINE = 'baseline.json'
$env:PAWN_REPLAY_OUTPUT = 'runtime.json'
node node_modules/vitest/vitest.mjs run --config "$bench/runtime.config.mjs"
python "$bench/runtime_receipt.py" app.json runtime.json "$bench/blind-reference.json" receipt.json
```

The experiments address one strategic feature and its contribution
to mixed decisions. They do not infer player intent or substitute
the captured pawn for the exact tactic that allows a move.
