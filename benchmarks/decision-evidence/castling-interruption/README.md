# When delaying castling allows a concrete attack

The earlier annotated review marked a mixed mistake in Esipenko–Wei.
After `14.Bd2 Qe8`, both `15.Kd1` and `15.g4` are better
than castling. `15.O-O-O` remains legal. It allows `...Qa4`
and an attack on the white centre. In contrast, the same `...Qe8`
is uncompetitive after castling on move 14. A king move shown
in the main line does not establish that it was forced.
[Annotated game](https://lichess.org/study/Y1yXP80U/jRlb31dr)

## Fixed transfer design

The sampler freezes two sets of 60 standard classical games from
retained public tournament broadcasts. Each set contains 20
instances of a checked king move, 20 king moves from outside check, and
20 games where the player castles later. The labels describe
the recorded shape and have no role in the engine verdict.
The starting castle was legal and the actual choice was a
non-capture by another piece besides the king or rook. The
cohorts exclude shared tournament families, games and mirrored
boards. The opened Candidates board is only calibration.

Both variants start from a same-depth global root and a paired
search of immediate castling and the played move. In the reference,
the castle has to be within 35 centipawns of the global lead. A
credible root advantage needs at least 70 centipawns; a difference
of 30 or less supports a negative for this diagnosis. Intermediate
scores and unstable readings remain unresolved.

The first variant recognises when the leading reply checks the
uncastled king and the two continuations move it, permanently
losing the original castling rights. The second also tests quiet
replies and any still-legal late castles. It compares every late
castle to the stronger defensive reply and requires a 70-centipawn
gap and a repeated forcing sequence with retained material loss.
It then checks the same attacking move after immediate castling,
which must become illegal or cost the attacker at least 70
centipawns in matched engine searches. Root and child searches
must agree about the first opponent move after the delay.

A repeated result describes the consequences of the shown move
order. Other legal defences can exist. The tactical claim comes
from the exact check or forcing line. The strategic interpretation
concerns what happens to the original castling option. The
position, immediate castle and played mistake remain separate.
No explanation is inferred merely from a king move or evaluation
drop.

## Enriched challenge

The first development and reserve replays each have 54 negatives,
six unresolved and no verified positives under this protocol.
That sample can expose obvious overcalls but cannot measure recall.
For a separate challenge, select previously unused games from the
same disjoint event groups. The recorded decision must still lead to
a king move of either kind. Cap the deterministic game sample at
380 cases per shape and group, then preview global and exact root
choices at 90k and 120k nodes. Run the full protocol on the
strongest scores that clear the preview criteria. The maximum is
24 decisions per group and four per tournament. The preview is for
sampling. Scores and verification use the higher-budget independent
queries in both groups.

## What the calibration establishes

At 4.8M and 8M nodes, `Bh3` is the best of the exact early
responses after `O-O-O Qe8 g4 Qa4`. Moving the g-pawn earlier
makes that bishop move legal. After `Bd2 Qe8 O-O-O Qa4`,
the g2 pawn still blocks it. Trying `g4` then allows
`...Qxa2` and a repeated queen attack on c4 and d4.
The late-castling penalty is real. The leading defensive
continuations after the late castle can avoid the same short
material loss, so the castling-only rule abstains. This
comparison uses one already reviewed position.
[Exact alternative replies](resource-timing.json)

## Reproduce

Use the cached public PGNs matching the selection manifest.
`freeze.py` regenerates the first sample. `stress.py` takes the
first selection, Stockfish executable and a new output path.
Both accept `--development` and `--reserve` PGN lists.
`capture.py {app,reference} SELECTION STOCKFISH OUT --split SPLIT`
evaluates the frozen decisions, then
`assess.py APP_FRAMES REFERENCE_FRAMES RESULTS` scores them.
The two calibration probes use the same Stockfish 19 binary
recorded in [the stress manifest](stress.manifest.json).
