# Captures allowed by a played mistake

This experiment tests one question in Decision Evidence. When a played move gets a much worse Stockfish evaluation, can the app identify a concrete capture it allowed and explain how a stronger move changes the same attack?

The previous worker can report an unclear mistake even when both existing engine searches find a concrete material loss. Its earlier motif and checking-defence paths require a named mechanism or a narrower form of defence. The new check replays the exact board after each choice and tracks the original pieces across legal continuations. It first verifies a named clearance or deflection if both played branches corroborate it. The broader check requires both played branches to contain the same capture, retain the material loss relative to both stronger branches, and show exactly where the attempted attack breaks after the stronger move. If that check succeeds, the report shows both engine lines. It can describe the material mechanism without assigning a motif. All search frames already exist in the normal app flow.

## Matched experiment

The matched worker comparison pins the baseline to `8d022f1b` and gives both workers identical engine frames. On the archived mistake references there are 67 reviewed tactical positives, 165 reviewed tactical negatives, and 85 uncertain labels.

| Tactical mistake diagnosis | True positive | False positive | False negative | True negative | Called on uncertain |
|---|---:|---:|---:|---:|---:|
| Baseline | 20 | 0 | 47 | 165 | 7 |
| Capture comparison | 22 | 0 | 45 | 165 | 7 |

Recall on the reviewed positives increased from 29.9% to 32.8%. Both workers had 100% precision among the reviewed positive and negative labels. A zero false-positive count on 165 references has limited scope. Neither figure measures general motif accuracy.

The three candidate checks were run on the same inputs. The outcome-only candidate confirms a named route with comparable material loss. The prevention candidate also requires a legal counterfactual that shows why the named attack fails. The capture candidate can verify an exact losing capture even when no named motif is established. Counts below are the candidate checks before applying the normal worker's existing verdict and gating. Some findings were already explained by the app.

| Input | Eligible frames | Named outcome | Named route prevented | Exact capture prevented | New worker diagnoses |
|---|---:|---:|---:|---:|---:|
| Archive | 199 | 0 | 0 | 7 | 2 |
| Archive depth arms | 66 | 0 | 0 | 2 | 2 replays of one archive game |
| Cached classical games | 571 | 2 | 1 | 11 | 1 |
| Independent puzzle positions | 53 | 1 | 1 | 7 | 4 |
| Frozen standard-chess broadcasts | 67 | 0 | 0 | 4 | 1 |

The integrated comparison covers 1,869 valid cached reports and 72 fresh reports. Every position and candidate-move report agrees. The changed mistake reports move from unclear to tactical, with no new supported mixed label. There was no full manual labelling of the fresh games. One new explanation in 72 gives a transfer example and cannot measure accuracy across those games.

The fresh selection uses archived Lichess broadcast PGNs. It excludes overlapping events, games, early game histories and colour-normalised root boards found in the cached inputs. It takes one previously annotated score loss per game, with 72 events represented. Explicit speed-event names and sub-hour controls are excluded. Exact playing time is unknown for games with no clock tag. The selection enriches for mistakes and gives no estimate of how often this finding arises in normal play.

## Higher-budget checks and examples

Six of seven distinct new cached diagnoses retain the exact capture proof in a fresh 4.8-million-node comparison. In the seventh, both deeper searches prefer the same attacking move but diverge on the ensuing queen exchange. The narrower material attribution is search-sensitive in that case.

- In Misamis, `33.Rxf4 Qxf4` loses the rook. With `33.Rd4`, the rook ends up on d4 and Black cannot capture it on f4. The higher-budget comparisons retain the proof.
- In the clearance puzzle, `26.Nxc6 Rxd1+ 27.Qxd1 Bxb2+ 28.Kxb2 Qxd1` works because `...Rxd1+` opens the d-file for the queen. `26.Rxd7` removes the rook that starts the line. The exact named mechanism and its prevention survive the deeper replay.
- In the fresh Dutch Open game, `18...Nd5 19.Nxe5` allows White to take the pawn on e5. After `18...e4`, the same knight move lands on an empty e5. At the higher budget `Nxe5` is still the best reply to `...Nd5` in both searches. Its forced counterpart scores +0.26 for White after `...e4`, compared with +2.67 for White after `...Nd5`. The searches change the move order of the exchange and the strict repeated-material check no longer passes.

The cached worker median was 74.56 to 75.52 ms. The fresh-sample median was 103.20 to 104.19 ms. These wall-clock measurements vary with concurrent work and exclude engine search. The production check makes zero extra Stockfish calls. It leaves late payoffs and distinct but equivalent capture sequences unresolved.

## Reproduce

Use python-chess, the project's Node dependencies, the retained research directory and Stockfish 19. The tested Windows binary has SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`. Fresh searches use one thread, 64 MiB hash, a 600k-node preview and 2.4M nodes for each matched root and reply search. Rechecks use 4.8M nodes per search.

1. Run `prepare.py cache RESEARCH inputs.json` in the retained research directory. Run `sample.py freeze RESEARCH inputs.json frozen-standard.json standard-manifest.json`, then `sample.py search frozen-standard.json STOCKFISH standard-fresh.json`. Source file hashes and the frozen engine input hashes are in [results.json](results.json).
2. From the repository root run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/allowed-route-mistakes/vite.config.mjs`. Set `ALLOWED_INPUT` and `ALLOWED_OUTPUT` for each input. With `ALLOWED_MODE=worker`, leave `ALLOWED_REVISION` unset for the baseline and set it to the revision containing this directory for the new worker. Outputs are `worker-v42.json`, `worker-v43.json`, `fresh-v42.json` and `fresh-v43.json`. Unset `ALLOWED_MODE` and keep the candidate revision for the candidate-check runs, with outputs `expanded-final.json` and `standard-pilot.json`.
3. For each newly diagnosed distinct case, take its input frame and add `recordedAttack` from `report.mistake.tacticalEpisode.playedLineUci[1]` in the new worker result. Run `prepare.py check CHECK_INPUT rechecked.json --engine STOCKFISH` on the seven cached cases and repeat for the fresh game with output `fresh-rechecked.json`. Replay each with the candidate-check runner to produce `rechecked-pilot.json` and `fresh-rechecked-pilot.json`. Run `score.py RUN_DIRECTORY results.json` to compare reports and record the independent rechecks.
4. Run `src/utils/tests/decisionAllowedRoutes.test.ts` for the original-piece, clearance, unsupported payoff, wrong-board, depth and divergent-line regressions. Run `node benchmarks/decision-evidence/allowed-route-mistakes/verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` with `ALLOWED_REVISION` set. The actual source-built panel was exercised at 320, 390 and 900 px, including keyboard expansion of played and stronger lines. This is source verification. Installed desktop verification is pending.
