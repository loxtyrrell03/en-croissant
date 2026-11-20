# What it costs to take the forking piece

The existing classifier can verify a fork when the forker captures one
of the original targets. Some sound forks have a different main reply:
one attacked piece takes the forker and is then captured by an ally.
En Croissant could show another motif or a weaker continuation without
explaining why the strongest defence still concedes material. The
promotion fork from Tsaghkadzor was an example in the previous neural
training-label audit.

Decision Evidence now accepts a second form of this fork explanation.
The root search and a separately searched best defence must show the
same legal capture of the forker and same-square recapture by an ally.
Both searches must retain a demonstrable net material gain, including
promotion, local exchanges and up to four further plies. Any material
captured on the first move is debited separately. A distinct searched
defence has to let the forker take an original, stationary target and
retain a gain. The new witness is conditional on the searched lines.
It reuses the existing position and move evidence cards and the original
checking and quiet fork certificates.

## Benchmark

The development panel and the sealed reserve each contain 72 different
Lichess puzzle games from the retained 13,680-game sample. Each panel has
36 solutions where a cheap search saw a capture of the forker and a
promising second reply, 18 solutions with a different second reply, and
18 legal alternatives to source puzzle moves. A single reviewer fixed
the exact-move labels after seeing legal Stockfish lines and before
seeing results for each panel. The reserve excludes the development
games and colour-normalised boards. The archived source puzzles had
been available in earlier neural experiments. These are targeted
panels, with uncertainty kept in the denominator as a separate count.
[Lichess puzzle database](https://database.lichess.org/#puzzles)

Each row measures the specific explanation that answering the fork
costs additional material. Other valid tactical explanations are
outside this endpoint. All methods use identical Stockfish 19 frames.

| Arm | Development positives | Development false reports | Sealed reserve positives | Reserve false reports |
| --- | ---: | ---: | ---: | ---: |
| Baseline worker | 0 / 8 | 0 / 45 | 0 / 12 | 0 / 39 |
| Two quiet plies after an immediate payoff | 1 / 8 | 0 / 45 | — | — |
| Same rule with collection allowed through ply seven | 1 / 8 | 0 / 45 | — | — |
| Legal exchange and retained material through the searched reply | 5 / 8 | 0 / 45 | 4 / 12 | 0 / 39 |
| Integrated worker | — | — | 4 / 12 | 0 / 39 |

The integrated reserve has four true positives, eight misses and no
positive among 39 reviewed negatives or 21 uncertain cases. The new
explanation changes one reserve decision from unclear to tactical.
The other three gains explain a fork on decisions already classified as
tactical. In the 1,051 archived requests, 1,050 existing reports match
apart from the report version and one remains unavailable. The first
prototype also left all 142 historical classical reports unchanged.
The separate public promotion example needed stable responses from a
deeper offline search to reach the new proof.

The first prototype waited for two quiet plies after capture and
required the full value of the original capture to be retained. That
underestimated play with an expected recapture or continuing checks.
The accepted rule combines the value of the legal same-square exchange
with the minimum material in the checked continuation. The change adds
zero Stockfish requests. Median full worker replay time across the
archive was about 61 ms for the baseline and 62 ms for the release in
separate runs on this PC. The reserve timing shows variation across
runs and gives no reliable estimate of a small overhead.

## Examples and limitations

- In `Bf6+ Qxf6 exf6+`, the queen takes the bishop and White retains
  at least 4.7 material points in the two played-out searches. `Kf7`
  allows `Bxd8` on the original queen square.
  [Lichess puzzle 05hkG](https://lichess.org/training/05hkG)
- In `c4 Bxc4 bxc4 Qxc4`, the exchange costs the defender 1.3
  material points. The other searched reply `Qd4` allows `cxb3`
  to take the original bishop. The same exact-move explanation works
  without a check. [Lichess puzzle 0GXmh](https://lichess.org/training/0GXmh)
- `d8=Q+` checks and attacks the a8 rook. The main line
  `...Rxd8 Rxd8+` gives up a rook for the pawn that promoted,
  while `...Kh7 Qxa8` leaves the promoted queen on the board.
  [Tsaghkadzor Open round 9](https://lichess.org/broadcast/tsaghkadzor-open-2026/round-9/FNrht2M6)

Eight reviewed positives in the reserve remain without this proof.
They include delayed recaptures through an intermediate check,
promotion on another square and a recapturing piece that takes the
other fork target later. The method currently requires direct payment
on the square where the forker was taken. It does not establish a full
forced line, a positional explanation, or the player's thought process.

The production component and worker display both lines and the
material consequence at 320, 390 and 900 pixels in a source-built
browser with cached Stockfish inputs. The test opens evidence through
the actual Analyse position and Show evidence buttons, including
keyboard focus. Installed desktop and mobile verification are pending.

## Reproduce

1. Use `collect.py deep` with `pool-preview.json` and
   `reserve-preview.json`, the recorded Stockfish 19 binary and
   Python 3.13 with python-chess. This runs a root-restricted
   1.2M-node search and an independent 2.4M-node MultiPV search
   at each selected position. The preview files retain the engine
   and source hashes. A second reserve run reproduced every score
   and continuation. Use `review_packet.py` to see the legal lines.
2. Set `FORK_INPUT` to a deep frame file and `FORK_OUTPUT` to a fresh
   path. Use `FORK_ARM=baseline` for the committed worker at `6481d4e9`.
   The candidate arms are `immediate`, `delayed` and
   `retained-immediate`. Use `release` to replay the integrated source.
   Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/fork-defence-concession/vite.config.mjs`.
3. Run the same worker on the retained
   `reply-coverage-audit/full-pair-input.json` for the archive.
   `score.py` matches all exact identities and compares report content.
   See the supplied reference labels and frozen hashes for the puzzle
   review. Use `decisionForkPayment.test.ts` for focused regressions and
   `verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` for the
   source-built panel check.

[Protocol](protocol.json) · [Results](results.json) · [Held-out reference](reserve-reference.json)
