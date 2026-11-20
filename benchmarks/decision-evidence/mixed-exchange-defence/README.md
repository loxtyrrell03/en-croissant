# Mixed mistakes and defended pawn captures

A material loss and damage to the pawn structure can follow the same
exchange. The tactical diagnosis needs a checked reason why taking back
fails. The positional diagnosis needs separate evidence about the pawns.

## Development example

After `29.Rb1 Bxf4 30.gxf4 Bxh3`, the existing worker reports that
White's f-pawns doubled. It leaves the tactical dimension unestablished.
`31.Bxh3 Rxf3` explains why the pawn cannot safely be taken back: the
bishop on g2 was guarding the knight on f3. `29.Nd4` gets that knight
out of the way before the same capture sequence. The two searches of
the played choice retain the material loss through ply six.
[Exact development frames](development.json), [earlier restricted engine searches](../shelter-consequences-v47/bra-cover-counterfactual.json)

The archived development replay covers 1,051 requests. The controlled
rule produces one new witness. Had it been promoted to a tactical
diagnosis, the number of mixed diagnoses among 17 frozen mixed
reference labels would have risen from one to two. Those labels include
some previously reviewed uncertainties, and this is a development result.

## Independent replay

The same inputs were used for the current worker, a broad early-exchange
heuristic, and the controlled rule. The broad heuristic tests a local
capture and a persistent material loss. The controlled rule also checks
the exact duty of the recapturing piece and replays the same exchange
after the stronger move. It requires that the stronger move save the
original piece that would be taken.

The sample covers 97 classical games from ten Lichess broadcasts and
56 distinct games in the Lichess puzzle database. The two samples are
independent of the earlier development positions. Each game contributes
one decision. The classical sample deliberately seeks early exchanges
from the game score, so it measures transfer on those selections.
Three puzzles and 83 classical decisions were excluded from the motif
score because the paired search had less than 60 centipawns of loss,
the played move led the preview, or at least one choice lacked a finite score.
The engine-derived reference uses separate restricted searches where a pawn can be taken
back. Its negatives describe this exact immediate mechanism, not whether
the position contained some other tactic. Five reviews are uncertain.
[Broadcast and sampling manifest](protocol.json), [Lichess puzzle database](https://database.lichess.org/#puzzles)

| Scoped motif score | True positives | False positives | False negatives | Reviewed negatives | Uncertain nominations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Classical, broad exchange heuristic | 0 | 0 | 0 | 14 | 0 |
| Classical, controlled comparison | 0 | 0 | 0 | 14 | 0 |
| Puzzles, broad exchange heuristic | 0 | 10 | 1 | 47 | 2 |
| Puzzles, controlled comparison | 0 | 0 | 1 | 47 | 0 |

The one confirmed positive is `1dYZE`. After the played `Qxd5`,
Stockfish finds `...Qxd5 Nxd5 ...Bxf2+`. Trying `Rxf2` lets the
e8-rook take on e1. The restricted recapture scores 300 engine
centipawns worse for the defender than the unrestricted search. The
existing report is unclear despite recording a loss. The stronger
`Nf5` stops the original queen capture, so the controlled comparison
cannot replay the same exchange. This is evidence for a different
kind of counterfactual. It does not validate either tested rule.
[Puzzle](https://lichess.org/training/1dYZE), [restricted search](positive-reference.json), [full scores](results.json)

An initial collection used the last UCI rows and sometimes included
bounds or incomplete MultiPV iterations. The published comparison
recaptured the same sample using only complete, exact iterations, as
the existing benchmark helper does. The corrected reference was saved
before the corrected outcomes were opened. The incomplete run is
excluded from the reported figures.

The controlled trial adds no engine searches and took under 1 ms
per independent request in this replay. Both trial rules remain offline.

## Reproduce

Run from the repository root with the project dependencies and Python
with `python-chess` installed. Set `EXCHANGE_OUTPUT` to a new
`worker.json` path. Set `EXCHANGE_INPUT` only when replaying a
different array of exact frames.

```sh
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/mixed-exchange-defence/vitest.config.mjs
python benchmarks/decision-evidence/mixed-exchange-defence/quick.py benchmarks/decision-evidence/mixed-exchange-defence/reserve.json > quick.json
python benchmarks/decision-evidence/mixed-exchange-defence/score.py worker.json quick.json
```
