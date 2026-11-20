# When avoiding check makes a promotion possible

The move report now compares two king moves when the preferred one
allows an existing passed pawn to advance and promote. The root search
and a separate reply search must show the same continuation through
promotion and retain the new piece for another four plies. The same
opponent capture must be legal after both king moves. It must give
direct check after the alternative and make the immediate promotion
illegal on that board. The report shows both lines.

The tactical reason is the difference in check. The strategic reason is
the demonstrated use of an existing passed pawn. The result describes
one examined defence. The same pawn can play a different role against
another reply. The position and mistake assessments keep their own
evidence. No additional Stockfish search is required.

## Hoogeveen example

In live Stockfish 19 analysis, the leading line is
`50.Kg1 Rd6 51.b7 Rxd3 52.b8=Q`. With the played `50.Kf3`,
`50...Rd6 51.b7 Rxd3+` forces White to answer the check. Stockfish still
finds other strong continuations after the played move. The move report
explains the promotion after `Kg1`. The mistake report remains unclear.

The earlier deep replay chooses `50.Kg2` and verifies the same
mechanism. The fixture includes the normal app's candidates, paired
root search and separate replies. The root starts in check, so choosing
between two otherwise ordinary legal king moves matters here.
[Hoogeveen game](https://lichess.org/broadcast/hoogeveen-open-2026/round-7/o4Nw35Ls/tl5cKsPg) ·
[Normal search fixture](fixture.json)

## Comparison

The development replay compares the exact support above with a looser
arm that only requires the same pawn to promote again in the separate
search. Both nominate the Hoogeveen example from 1,460 cached inputs
and recover no other example. The development checker initially
excluded king moves played while in check and missed Hoogeveen. The
revised gate accepts legal evasions while still requiring the later
capture to be the same.

The separate transfer selects 144 fresh public classical games from 51
event families, excluding the Hoogeveen family and overlapping
positions and games from the named development sources. It favours
endgames with an existing passed pawn and an available king move.
Eleven games yield a distinct quiet king leader plus a valid paired
comparison. Just one of those has a promotion in its initial paired
line within the proof window. Neither arm finds another proved
dependency. This sample establishes the low yield of a narrow check.
It gives no estimate of overall classifier accuracy.

The complete worker replay changes one leading-move explanation from
unclear to mixed across 1,459 valid cached decision reports. All other candidate explanations,
position assessments, and mistake reports agree. All 144 fresh
reports agree. The repeated cached run reproduces those results.
Median cached worker time is 73.0 ms before and 72.6 ms after, excluding
Stockfish and the UI. The timings vary with concurrent work.

The proof tests reject a control king square that avoids check as well,
an unrelated reply board, a score bound, a short continuation and a
different corroborating defence. Source-browser verification exercised
the existing panel at 320, 390 and 900 pixels, including expanding
both lines with the keyboard.
[Replay and timings](results.json)

Lugano's verified mechanism from the preceding study is a different
kind of tactical dependency. The rook takes away king flights after a
knight check when the pawn advances against it. The ordinary app search
did not show that same check against the pawn in the stronger branch,
so this verifier has insufficient evidence for that comparison.
[Lugano counterfactual](../paired-passer-benchmark/README.md#reviewed-comparisons)

## Reproduce

Run from the repository root using the project dependencies, the
retained `classifier-rework` directory, Python with python-chess and
NumPy, and Stockfish 19. The engine SHA-256 is
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.

1. Run `prepare.py LAB cached.json cached-manifest.json`. Run
   `fresh.py freeze LAB fresh.json fresh-exclusions.json`, then
   `fresh.py score fresh.json STOCKFISH fresh-scored.json`. The fresh
   scores use 2.4M root and paired nodes and 1M reply nodes. The inputs
   and original byte hashes are in the receipt.
2. Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/promotion-check-tempo/vite.config.mjs`.
   For both-arm comparisons set `PROMOTION_TEMPO_INPUT` and
   `PROMOTION_TEMPO_OUTPUT` to the frozen frames and a new output.
   Use `cached-final-results.json` and `fresh-final-results.json` for
   the two inputs.
   For full reports set `PROMOTION_TEMPO_FULL=1`. Leaving
   `PROMOTION_TEMPO_ASSESSMENT` unset selects the baseline. Set it to
   the candidate revision for the product replay, and to that revision
   with no input set to run the regression tests. Save the full comparison
   outputs as `full-base.json`, `full-product.json`,
   `fresh-baseline.json`, and `fresh-product.json`.
3. For the live frame capture, set `PROMOTION_TEMPO_ENGINE` to
   Stockfish and supply the rows ending `03b0bbd727d6f3fb` and
   `24058c51cfa95ff0` from the paired study's `examples.json`.
   Capture the output and replay it without `PROMOTION_TEMPO_ENGINE`,
   with the product revision and full output to
   `live-product-final.json`. Run `summarize.py RUN_DIRECTORY OUTPUT`
   to compare the saved reports. The raw inputs are retained under
   `classifier-rework/promotion-check-tempo`.
4. Run `verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` with
   `PROMOTION_TEMPO_ASSESSMENT` set to the revision under test. It builds the
   source worker with fixed live engine frames. Installed-native
   verification is pending.
