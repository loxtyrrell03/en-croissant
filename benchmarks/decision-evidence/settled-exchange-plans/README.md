# Strategic plans that emerge after an exchange

The previous move assessor could miss a file or passed pawn that first
appeared after the recaptures. The new check replays the root line and
the separately searched reply. It finds an early, materially balanced
sequence involving the original moving piece. It follows the original
pawn or rook through both continuations. The explanation needs an
actual advance by the new passer or a rook entering or advancing on
the cleared file. The two searches must agree on the original
captures and the identity of the piece that uses the resulting board.
The move panel displays the continuation and labels the positional
interpretation as heuristic.

## Comparison

| Input | Requests | Shared board shape | Both searches use the asset | Same actor and original captures |
| --- | ---: | ---: | ---: | ---: |
| Retained classical, puzzle and course inputs | 1,625 | 70 | 6 | 6 |
| Separate classical games | 160 | 43 | 17 | 16 |

The new sample covers 53 event families. It excludes the development
examples' events, existing game signatures and mirrored boards
available in the retained inputs. The sampler uses 80 games with an
observed use of the asset in the recorded game, 40 where the geometry
appears without use, and 40 other materially balanced sequences.
Sampling precedes the new Stockfish analysis. The geometry comparison
would nominate many boards without concrete use in both searches.
One additional used-asset nomination has different captured original
pieces across the two searches and fails the identity requirement.
[Frozen protocol](protocol.json)

| Worker comparison | Valid reports | Unclear to positional | Tactical to mixed | New explanations repeated at higher depth |
| --- | ---: | ---: | ---: | ---: |
| Cached, versus `a779f152` | 1,624 | 5 | 0 | 3 |
| Separate classical games | 160 | 8 | 1 | 6 |

The deeper run uses 4.8M root nodes and 2.8M reply nodes, versus 2.4M
and 1.4M for the fresh frames. The six new repeated explanations
come from five distinct event families. The other three fresh
explanations describe legal lines that were selected at the first
budget. The same asset use does not repeat in both higher-budget
searches. This is a scoped transfer result from enriched games. It
has no comprehensive new reference labels for overall recall.

The complete before-and-after worker replay matches every position
and mistake report. It took about 233 seconds per worker including
the prototype scan, with both workers running concurrently. The
normal Amsterdam workflow uses the same three Stockfish searches in
both versions. The additional explanation reuses those frames.
[Counts, exact changes, and live query receipt](results.json)

## Examples

- **Amsterdam.** After `50...Bxe5 51.dxe5`, `51...d4` advances the
  newly passed d-pawn. The existing local tactical certificate
  describes a material gain Black can choose by playing `...Kxe5`.
  The matched restricted search scores `...d4` at +1.26 and
  `...Kxe5` at +0.09 for Black. The material option and the engine's
  preferred pawn plan are two distinct reasons to consider the
  bishop capture. The same-position live replay now reports Mixed.
  [Game round](https://lichess.org/broadcast/amsterdam-chess-open-2026-group-a/round/fXoFR8Bu)
- **Romanian Team Championship.** After the queen and a-file pawn
  exchanges, the same rook enters on a3 in one search and a2 in the
  other. The original file access survives the deeper comparison.
  [Game](https://lichess.org/broadcast/romanian-team-chess-championships-2026-mens-super-league/round-8/ie0yeJxy/ttOERTF7)
- **Tajikistan.** After `...fxe6 Qxd6`, the rook uses `...Rfd8`.
  The f-pawn's capture and White's removal of the original d-pawn
  leave the d-file available. The exact move explanation was unclear.
  [Game](https://lichess.org/broadcast/2nd-presidents-cup-of-the-republic-of-tajikistan-2026-group-a/round-6/ks5IDx73/dLvehKGI)
- **Witney reference correction.** After `Qh8+ Rd8 Qf6 Qxf6 exf6`,
  the original f7 pawn still blocks f6. The earlier description
  called f6 passed. At 2.4M nodes, after `...Rd8` the queen trade
  scores 1.93 pawns better for Black than the next tested choice.
  After `...Kb7`, `...Qc3` and `...Qxf6` are equal in the same
  search. The corrected position rationale cites the concrete
  queen interaction in the `...Rd8` line and c-file play in the
  separate `Rbc1` plan. The original benchmark labels stay frozen.
  The exchange-plan verifier finds no corroborated use in the
  two `Qh8+` lines.
  [Game](https://lichess.org/broadcast/witney-congress-2026-open/round-4/vuoKpoey/EMvsmEdQ) ·
  [Exact review searches](reviewed-searches.json)

The source-built panel was checked at 320, 390 and 900 pixels.
Installed verification is pending. The checks cover legal
line identity and show a specific recurring plan. Broader position
and mistake recall still require separate work.

## Reproduce

Run from the repository root with the project dependencies,
python-chess, NumPy and Stockfish 19 of the hash in
[results.json](results.json). The complete inputs are retained under
`classifier-rework/settled-exchange-plans`.

1. Run `examine.py LAB archive-v2.json` for the cached inputs, then
   `fresh.py freeze LAB fresh.json exclusions.json` and
   `fresh.py score fresh.json STOCKFISH fresh-scored.json`. Call
   `examine.py LAB fresh-output.json --explicit fresh-scored.json`.
2. Run `recheck.py LAB archive-v2.json STOCKFISH archive-deep.json`.
   Repeat with `fresh-output.json`, `fresh-deep.json` and
   `--explicit fresh-scored.json`.
3. Run `receipt.py prepare LAB RUN_DIR`. Set
   `SETTLED_EXCHANGE_INPUT` to the resulting `base-input.json` and
   `SETTLED_EXCHANGE_FULL=1`. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/settled-exchange-plans/vite.config.mjs`.
   Use `SETTLED_EXCHANGE_OUTPUT` for `full-baseline.json` with no
   revision override, then `full-product.json` with
   `SETTLED_EXCHANGE_REVISION` set to the product revision.
4. With the input unset, run the same test configuration with
   `SETTLED_EXCHANGE_ENGINE` set to Stockfish for `live-base.json`
   and `live-product.json`. Use revision `a779f152` and
   `SETTLED_EXCHANGE_BASELINE=1` for the former. Without an engine
   or input the test configuration runs the focused proof tests.
5. Run `receipt.py compare LAB RUN_DIR --output results.json` and
   `review.py STOCKFISH reviewed-searches.json` for the exact
   comparisons. The source-browser test is
   `verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` with
   `SETTLED_EXCHANGE_REVISION` set to the product revision.
