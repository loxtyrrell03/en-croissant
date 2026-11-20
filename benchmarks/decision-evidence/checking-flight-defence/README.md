# A quiet move that takes away a king flight

The normal analysis workflow can now explain a missed passed-pawn
defence using the same legal pawn push and the same check after two root
choices. Candidate geometry only nominates a search. Stockfish must
rank the check among the leading defences after the better choice. A
separate restricted search must show that the same check fails after
the played move, with the opponent actually using the newly available
king square. The comparison needs a concrete payoff on both boards.

In Lugano, after `41...Rb2 42.b7 Ne3+`, the rook covers e2 and f2.
Stockfish plays `Kg1` and finds a line where the rook takes the b-pawn.
After `41...Rd4 42.b7 Ne3+`, `Ke2` is legal. In the short search,
`...Rb4 Kxe3` wins the knight. The higher-budget line uses the same
king flight and promotes instead. The better route still stops the
same pawn. The played move gets a tactical explanation. The better
move is mixed because putting the rook on the b-file supplies both the
check's king-square coverage and the later pawn capture.
[Game](https://lichess.org/broadcast/xix-international-chess-open-lugano-standard/round-1/r2h3ZELp/nzJyOclZ) ·
[Exact frames](fixture.json)

## Results and cost

| Input | Count | New query nominations | Confirmed diagnoses |
| --- | ---: | ---: | ---: |
| Reviewed Lugano development witness | 1 | 1 | 1 |
| Earlier archived requests with a recorded move | 841 | 0 | 0 |
| New classical games excluding the Lugano event | 128 | 0 | 0 |
| Existing reserve subset with a geometry-selected alternative | 64 | 0 | 0 |

The fresh selection keeps one decision per game from 44 event
families. Half have matching geometry under some legal alternate
slider move. Half are related advanced-pawn controls without that
shape. The sample excludes the development games and mirrored boards
available in the recorded archives. Given normal search choices,
22 games have a complete scored pair from the same piece. None
supplies all the required evidence for a query. In the additional
64-game geometry-selected stress test, the first geometrically
eligible alternative fails to improve the evaluation in 59 games.
The remaining five have no qualifying pawn push with the required
loss and scores. This shows why geometry alone is a poor reason to
spend engine time. These are sample counts, without comprehensive
labels for other tactics and positional effects.

| Node budget per query | Black after the check with ...Rb2 | Black after the check with ...Rd4 | White's payoff after ...Rd4 |
| --- | ---: | ---: | --- |
| 500,000 | +0.12 | −7.34 | Takes the knight |
| 2,400,000 | +0.09 | −8.17 | Takes the knight |
| 4,800,000 | +0.14 | −8.46 | Promotes and retains the new piece |

All three searches use the same check and the same covered flight.
The strict prototype required the knight capture, so it lost the
4.8M witness. The broader version accepts a surviving promotion
of the original passer when it follows the same verified king
flight. It cannot nominate a separate pawn or a different check
after seeing the deeper result.

The normal app replay uses the five baseline searches and two extra
500,000-node queries. On the tested machine the paired runs took
6.08 and 7.41 seconds. The same extra queries and evidence repeated
in a later run. The two queries share a three-second cap within the
existing analysis deadline. A cancellation at the start of this
phase releases the analysis before it launches either new query.
The extra work is only scheduled after the geometric and score checks.
[Counts and live query record](results.json)

The source-built panel shows both exact lines and the checked reason
at 320, 390 and 900 pixels. Installed verification is pending. The
newly supported explanation concerns one reviewed case. The fresh
results do not establish general recall gains.

## Reproduce

Use the retained `classifier-rework` directory, project dependencies,
python-chess, NumPy, and Stockfish 19 of the hash in
[the protocol](protocol.json). Run the scripts from the repository root.

1. Run `receipt.py lugano LAB RUN_DIR` to extract the live development
   case from the preceding promotion study. Run `probe.py LAB
   RUN_DIR/lugano.json STOCKFISH RUN_DIR/archive-final.json` for the
   cached replay and the three Stockfish budgets.
2. Run `reserve.py freeze LAB RUN_DIR/reserve.json RUN_DIR/exclusions.json`
   and `reserve.py score RUN_DIR/reserve.json STOCKFISH RUN_DIR/reserve-scored.json`.
   Pass the scored input to `probe.py` with `--explicit-only` and
   output `reserve-results.json`. Run `receipt.py stress LAB RUN_DIR`,
   then score `stress.json` as `stress-scored.json` using
   `--geometry-only`. Probe that with `--explicit-only` and output
   `stress-results.json`.
3. Run `receipt.py screen LAB RUN_DIR`. Use `RUN_DIR/app-screen.json`
   as `PASSER_FLIGHT_SCREEN` and `RUN_DIR/app-screen-results.json` as
   `PASSER_FLIGHT_OUTPUT`. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/checking-flight-defence/vite.config.mjs`.
   With those variables unset the same configuration runs the proof tests.
4. Set `PASSER_FLIGHT_ENGINE` to Stockfish and the output to
   `live-baseline.json`, `live-product.json`, or `live-final.json`.
   For the baseline use `PASSER_FLIGHT_REVISION=f851ecda` and
   `PASSER_FLIGHT_BASELINE=1`. For the product use the candidate revision.
   To verify cancellation set `PASSER_FLIGHT_ABORT=1`. The resulting run
   generates no line receipt by design.
5. Run `receipt.py summarize LAB RUN_DIR --output OUTPUT` to compare
   exact frames and timing counts. Run `verify-panel.mjs PLAYWRIGHT_MODULE
   CHROME_EXECUTABLE` with `PASSER_FLIGHT_REVISION` set to the candidate
   revision for the source-browser check.
