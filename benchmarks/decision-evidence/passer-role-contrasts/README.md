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
```

The experiments address one strategic feature and its contribution
to mixed decisions. They do not infer player intent or substitute
the captured pawn for the exact tactic that allows a move.
