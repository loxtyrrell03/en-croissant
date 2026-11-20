# When a stronger move restrains a passed pawn

A move can lose because it gives the opponent a concrete exchange or checking sequence that makes an existing passer harder to stop. The exact same branch can still contain a separate strategic fact. The original pawn advanced and the defender no longer had a sound capture. This study checks those two claims separately.

The baseline is En Croissant `31f8e50c`. The trial uses identical paired Stockfish root searches and reply searches. It tracks the original pawn and defender, tests the same legal advance in two early checkpoints after the stronger choice, and checks that taking it would gain material in the local exchange. Each played line must contain the actual advance and lack even an equal capture on that square.

Three candidate comparisons use the same frames.

- **Advance** accepts an advance that survives two plies after the move is made.
- **Lasting** requires four plies.
- **Combined** adds evidence for two specific tactical mechanisms. Both played lines can retain a material loss from taking the pawn. Alternatively, both can show the same exchange sacrifice, which preserves the original pawn supporting the push. The sacrifice has to lead the separate reply search by at least a pawn in Stockfish's evaluation over the next searched move. That score difference concerns candidate moves on one board.

A fourth comparison uses a separate restricted Stockfish search of each proposed capture. It confirms the capture score stays within 100 engine centipawns of the stronger root's score or better, and at least 75 centipawns above the played root's score. All required checkpoints must pass. The score test is relative to the tested alternatives and does not establish the best continuation on every board. It is an experimental criterion selected after inspecting the weaker nomination.

## Results

| Source | Requests | With paired and reply frames | Advance | Lasting | Combined | Confirmed |
|---|---:|---:|---:|---:|---:|---:|
| Reviewed archive | 1,051 | 199 | 2 | 1 | 2 | 1 |
| Archive depth arms | 68 | 66 | 1 | 0 | 1 | Duplicate of archive game |
| Separate cached classical decisions | 700 | 571 | 3 | 1 | 1 | 1 |
| Independent puzzle decisions | 56 | 53 | 0 | 0 | 0 | 0 |
| First frozen passed-pawn sample | 72 | 42 | 2 | 2 | 2 | 2 |
| Separate frozen replication | 72 | 33 | 0 | 0 | 0 | 0 |

On the originally reviewed archive, the simulated confirmed worker gains one true positive on each axis. It counts an unavailable reviewed report as a missed positive where applicable.

| Reviewed mistake axis | Baseline TP / FP / FN / TN | Confirmed comparison TP / FP / FN / TN | Unknown labels |
|---|---:|---:|---:|
| Tactical | 22 / 0 / 46 / 165 | 23 / 0 / 45 / 165 | 85 |
| Positional | 20 / 0 / 69 / 164 | 21 / 0 / 68 / 164 | 65 |
| Mixed | 1 / 0 / 16 / 185 | 2 / 0 / 15 / 185 | 116 |

The first new sample contains a real mixed diagnosis and a better explanation for a mistake that the worker already calls positional. The exchange-sacrifice arm was developed after examining the first sample. The second sample used different games and colour-normalised boards and yielded zero new evidence. Both samples reuse tournament families from the earlier benchmarks. Neither sample has comprehensive manual mixed labels, so their counts measure evidence yield.

The original false lead is a separate Grand Swiss game. A local recapture calculation likes `...Rxa7`, but one restricted continuation scores −8.21 for Black, worse than the paired played choice's −7.13. The confirmation rejects it. In a cached game `...Rc8` keeps `...Kxd7` available and the follow-up check confirms that defence. A deeper principal variation actually takes the pawn sooner, so the current same-location screen does not repeat there.

## Examples

- **Checking sequence and containment.** After `67...Kd7 68.Re7+ Kc6 69.Rc7+ Kd5 70.d7`, both lines take the pawn with a rook and lose that rook on d7. After `67...Rf7`, `68.d7+ Kxd7` holds a draw in the restricted search. Three distinct tested checkpoints sustain the king capture. At the higher paired budget, one better line switches to trading the rook on e7 and the other actually plays `...Kxd7`. The exact nomination no longer fires under its requirement that the pawn stays on d6 throughout the earlier comparison.
- **Exchange sacrifice and pawn support.** After `51...Kb6 52.Rxa7 Kxa7 53.d7`, the c6 pawn supports d7. In a 4.8M-node reply search, `52.Rxa7` scores −0.01 for White and the next examined reply scores −5.57. Testing `52.d7` immediately instead scores −9.23. `51...Nxc6` takes the supporting pawn before the exchange. Both main proof lines and the direct tests support the combined diagnosis at the higher budget.
- **Rook placement in a pawn race.** `58...Rf8` keeps `Rxf7+` available when White pushes the f-pawn in both checked boards. After `58...Ka6`, Stockfish repeatedly finds a line in which the f-pawn advances and remains in play. The app already picks up the rook's open access to the file. The trial explains the particular pawn it restrains and leaves the tactical dimension unestablished.

The three candidate checks together took a median of about 5 ms on matched transfer inputs, excluding engine time. The additional verification used two 4.8M-node searches per checkpoint, with a median of 6.34 seconds per checkpoint in the concurrent run. Up to three checkpoints were needed for one case. The current app's analysis session is bounded. The verification has no proven normal-budget cost or independent gain sufficient to enable it, so this work remains a benchmark.

## Reproduce

Use the retained research directory, Python with python-chess, and Stockfish 19. The tested binary has SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`. The [results](results.json) include hashes of the cached and frozen inputs and the source manifests.

1. Rebuild the cached frame input using the previous [matched replay](../allowed-route-mistakes/README.md). Run `freeze.py SAMPLER RESEARCH FROZEN MANIFEST ARCHIVE PRIOR_FRESH`, where `SAMPLER` is the previous benchmark's `sample.py`. Run a second selection including the first search frames as an additional excluded input. The selections require a sixth-rank enemy passer and a previously annotated loss of at least 65 centipawns. They take one board per game. Explicit speed-event names and tagged sub-hour controls are excluded. The underlying PGNs have incomplete clock tags.
2. Analyse the two freezes with the previous `sample.py search` command. Preview uses 600k nodes. Matched roots and reached-board replies use 2.4M each, one thread and 64 MiB hash.
3. From the checkout root run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/passer-restraint/vite.config.mjs`. Set `RESTRAINT_INPUT` and `RESTRAINT_OUTPUT` for `inputs-pinned.json`, `fresh-search-pinned.json` and `replicate-search-pinned.json`. Use the previous worker replay with `ALLOWED_REVISION=31f8e50c` for the matched worker receipts. The four regression tests run with `RESTRAINT_INPUT` unset.
4. Run `verify.py pinned-controls.json STOCKFISH benchmarks/decision-evidence/defence-after-attack --inputs ARCHIVE FIRST SECOND --replays ARCHIVE_REPLAY FIRST_REPLAY SECOND_REPLAY`. It tests the exact same advance with the proposed capture restricted. For budget sensitivity, repeat the paired root and reached-board replies for each distinct nominated case with the previous `prepare.py check` at 4.8M nodes, then replay as `positional-deeper-pinned.json`.
5. Run `score.py THIS_RUN PREVIOUS_RUN results.json`. To check the exchange-sacrifice example directly, use the `support` entry in [fixtures.json](fixtures.json). Search the exact board after `...Kb6` first with MultiPV 3, then restrict the reply to `d7`. Repeat after `Rxa7 Kxa7`. Use 4.8M nodes, one thread and 64 MiB hash for each.
