# Played moves that line up two pieces

The reviewed `20.Bh4 Qh7` decision exposed a gap in the three-scope
classifier. The queen wins the knight on h5 or the bishop behind it
on h4 in different continuations. After `20.Qc1 Qh7`, White has
`21.Nxf6 Bxf6 22.Bxf6 Nxf6` and avoids the material loss. The
position's best move or its available tactics supply insufficient
evidence by themselves. [Exact original searches](../current-classifier-audit/classical-counterfactuals.json)

## Experiment

The geometry control looks for a quiet bishop, rook or queen reply
with two opposing major or minor pieces on the same ray. The played
move must place one of those two pieces. The front capture must
be legal if the opponent makes no intervening change. This is a
nomination for analysis. The rear piece may be safe, a defenders'
counterattack may refute both captures, or the whole alignment
may have no effect on the earlier decision.

The first candidate requires a paired root comparison, an
independent reply search, and one material loss linked to the
original attacking piece and a specific original target. The
same opponent reply must leave the material balance essentially
intact in the better branch at the compared horizon. The second
candidate asks for the loss in both independently searched
played continuations. The third asks for different defensive
choices and different original victims, so the two lines show
both sides of the alignment rather than an incidental target.
All three compare the material change after allowing an immediate
recapture and require the stronger choice to break the alignment.

## Data

The sample uses classical broadcast PGNs with declared clocks of
at least 60 minutes per side. It preserves the full move history
before each decision. The regular ray cohort is selected from
board geometry and the moves actually played. The enriched
cohort requires the recorded game to contain an early material
loss associated with the same attacking piece. These inputs
enrich the test and do not set its reference labels. Ordinary
controls are drawn separately. No position score, model output
or classifier output is used in selection. The groups use event
families, game prefixes and colour-normalised positions to keep
the packets separate. Some source broadcasts were used in earlier
experiments. The earlier played-move diagnostics and 72-game audit
are explicit exclusions.

The [frozen sample](sample.json) records source hashes, quotas
and the exact selections. The course collections and player game
libraries are outside this targeted transfer test.

## Reproduce

From the repository root, use Python with python-chess and the
same Stockfish 19 binary as the [classical audit](../current-classifier-audit/README.md).
`freeze.py` takes the source index stored in the sample, the parent
directory of the listed PGNs and the two exclusion archives specified
in the sample. Save the source array as a JSON file when regenerating
the selections. Use the committed sample directly for the engine
comparison. Stockfish fixed-move searches constrain only the moves
explicitly listed at the root of each search. [Stockfish UCI documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html)

```powershell
$bench = 'benchmarks/decision-evidence/shared-ray-mistakes'
python "$bench/capture.py" "$bench/sample.json" development app $stockfish dev.json
python "$bench/capture.py" "$bench/sample.json" enrichedDevelopment app $stockfish dev-enriched.json
python "$bench/ray_review.py" dev-preview.json dev.json dev-enriched.json
```
