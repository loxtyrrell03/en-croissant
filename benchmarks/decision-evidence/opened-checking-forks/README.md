# Checking forks enabled by an opened line

Decision Evidence can explain a mistake when the played move opens a
slider's route directly or starts an exchange that opens it. The
checking piece must attack a second, tracked piece and take it in
both of the weaker continuations. A legal exchange check confirms
the take. The two stronger lines must retain more material after
the immediate response. The explanation names the opened square,
check, captured piece, and earlier prevention.

For `Qxd5 Qxd5 Nxd5 Bxf2+`, the knight leaves e3 and opens the
bishop's diagonal. The bishop checks and attacks the rook on e1.
Both searches show `Bxe1` after `Kh2`. `Nf5` keeps the queen off d5,
preventing the first exchange. The shown material comparison is
bounded to eight plies. This explains a tactical consequence in the
analysed lines.
[Example 1dYZE](https://lichess.org/training/1dYZE)

## Independent results

The first variant kept the target on its original square. The
second tracks its identity through moves and recaptures, and can
show how the stronger choice moves the recapturing piece first.
The replays use the same exact, complete Stockfish 19 frames.
A separate 1.7-million-node opponent search and independent legal
replay produced the reference. The selected puzzle families enrich
for the tested mechanism. They are game- and board-disjoint from
the development sample. The replication uses a later source slice
with the same verifier. These are targeted engine-reviewed labels,
with representative examples inspected on the board.
[Sampling and freeze](protocol.json), [puzzle source](https://database.lichess.org/#puzzles)

| Sample | Stationary target | Tracked target | Reviewed negatives | Current worker with tactical support | Updated worker with tactical support |
| --- | ---: | ---: | ---: | ---: | ---: |
| 69 fresh puzzles | 11 of 33 | 16 of 33 | 24 | 29 of 33 | 30 of 33 |
| 130 replication puzzles | 16 of 53 | 27 of 53 | 54 | 38 of 53 | 44 of 53 |

Both proof variants produced zero false positives in the reviewed
negatives. Twelve uncertain and 23 ineligible cases across the
two puzzle samples are outside those denominators. The production
fallback supplies a diagnosis when the current worker lacks one.
The first sample alone produced one new diagnosis, below the
predeclared minimum of two. The replication added six with no
contradictory new explanations, meeting the gate without revising
the classifier.
[Results](results.json), [initial reference](reference.json), [replication reference](replication-reference.json)

An event-sourced control sampled 77 classical games using recorded
exchanges and legal opponent reply geometry. Eleven eligible controls
were reviewed negatives. The reference found no positives for this
exact mechanism. Classical recall therefore remains unmeasured for
this feature. All 1,050 valid reports from the separate archived game
replay match apart from the report version. Position character,
move justification, evaluation losses, and the positional dimension
of mistake reports match throughout the compared replays.
[Classical controls](classical-reference.json)

No extra Stockfish searches are needed in the app. Archived median
worker time was about 62 ms for both arms. The source-built analysis
panel opened both checked lines on 320, 390, and 900 px layouts.

The verifier currently abstains when the payoff moves to a different
attacker, a close alternative leaves the same route available, or
the two engine lines fail to confirm the early capture. It does not
set the positional dimension of the verdict.

## Reproduce

Run from the repository root. Set `OPENED_REVISION` to `b778ee8b`
for the baseline and to the committed v34 candidate for the second
run. Set `OPENED_OUTPUT` to a different new JSON path for each run.
For the replication, set `OPENED_INPUT` to `replication.json` in
this directory and pass the replication reference to the scorer.
The replay uses the saved engine frames.

```sh
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/opened-checking-forks/vitest.config.mjs
python benchmarks/decision-evidence/opened-checking-forks/score.py before.json after.json
```
