# Corroborate compensated alternate captures

In the previously reviewed European Club Cup game, the mistake report
claimed that 21.Ne5 Nxe5 won a pawn. The material checker evaluated a
capture sequence on e5. Both normal and deeper Stockfish frames played
22.fxe5 and kept the material even. A separate root-constrained search
after fxe5 showed that trying to collect the pawn with 22...Bxe5
allows 23.Bxb7 and evaluates about +4.4 for White. The original local
bound did not account for that later counterplay.

The shared mistake adapter passes the exact searched alternate reply
through to the capture proof. It still requires a legal local gain and
checks that the better move keeps the same original target safe. When
the claimed gain is smaller than the piece taken, the same line must
retain it after the capturing side next plays quietly and the
opponent answers. Losses elsewhere count against the claimed gain.
Later off-square gains do not fund it. The verified alternative line
is attached to the mistake review. Clean hanging-piece explanations
continue to use the existing bounded capture check.

## Results

| Replay | Before | With the corroboration |
| --- | --- | --- |
| Known European Club Cup mistake | Tactical | Unclear |
| Same game at the deeper engine budget | Tactical | Unclear |
| Other 25 prospective classical decisions | Same verdicts | Same verdicts |
| 120 fresh public games, one chosen decision per game | Same verdicts | Same verdicts |
| Archive, 1,050 valid reports in 1,051 requests | Same verdicts | Same verdicts |

Among the known prospective tactical labels, the worker retains one
of two true positives and removes the one false positive. The separate
archive retains a genuine allowed `...gxh5` alternative which wins the
original pawn. The fresh replay contains no reports attributed to this
alternative-capture fallback. It is a stability check with a focused
selection, and gives no estimate of the recall of the fallback.

Two simpler variants also remove the Club Cup false positive.
Rejecting all compensated gains also discards a legitimate 2.2-point
gain in a legal control. Counting all the material in the branch can
credit an independent rook capture for a different exchange, as tested
by a second legal control. The scoped corroboration separates those
cases. These two controls are constructed. A second independent
real-game case of a compensated gain remains unverified.

The change uses existing Stockfish searches. The median time spent by
the worker in the separate archived runs was 64.41 ms and 64.79 ms.
These figures exclude engine search and are subject to background load.
The Club Cup mistake still has an unresolved positional component.
The rule abstains where no settled line is supplied within ten plies.
It gives no conclusion about longer tactics or the overall position.
The source-built panel shows the updated verdict and still displays the
measured evaluation loss. Keyboard expansion was tested at 320, 390
and 900 pixels.

## Reproduction

The input paths, hashes, fresh public IDs and public PGN hashes are in
[results.json](results.json). All records are derived from the existing
local copies. The benchmark commit pins the original build to `b6eb8757`.

1. To recreate the fresh split, run `sample.py OUTPUT LAB 120 EXCLUDE...`
   from the repository root, with the lab containing the public
   tournament PGNs. Use `allowed-route-mistakes/inputs.json`,
   `current-classifier-audit/prospective-scored.json`,
   `current-classifier-audit/matched-early.json`,
   `allowed-route-mistakes/standard-fresh.json`, and
   `decision-draw-transport/heldout-scored.json` as exclusions. The
   selector checks game histories and colour-normalized root boards.
   It uses the broadcast loss annotations to select positions with
   at least two immediate legal captures, including one that can be
   recaptured. It excludes identifiable speed events and tagged
   sub-hour games. Clock metadata is incomplete.
2. Score the fresh split using the [same Stockfish 19 runner](../draw-aware-search/README.md#reproduction)
   at 2.4M root and 1.4M reply nodes. The binary SHA-256 is
   `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.
   Prepend the existing 26 scored prospective decisions to the new
   output to form `transfer.json`. Use the Club Cup row of
   `prospective-deep.json` and the archived Tournament of Peace
   `...gxh5` row for `controls.json`, in that order.
3. Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/alternate-capture-payoff/vite.config.mjs`.
   Set `ALTERNATE_CAPTURE_INPUT` to the scored array and
   `ALTERNATE_CAPTURE_OUTPUT` to a new file. Leave
   `ALTERNATE_CAPTURE_REVISION` unset for the baseline. Set it to
   the milestone commit for the corrected build. With the latter,
   set `ALTERNATE_CAPTURE_ARM` to `direct-only` or `all-material`
   for the simpler comparisons. Also set
   `ALTERNATE_CAPTURE_TEST_CONTROLS=1` to run the exact regression
   tests with the selected variant.
4. Save the four `transfer-*.json` runs, both `controls-*.json`
   runs and `archive-product.json`. Score with
   `score.py RUN_DIRECTORY LAB OUTPUT`. The archive input is
   `reply-coverage-audit/full-pair-input.json`. Its matched baseline
   output is `current-classifier-audit/archive-product.json`.
5. The public Club Cup engine frame is included for the
   source panel check. Run `node benchmarks/decision-evidence/alternate-capture-payoff/verify-panel.mjs PLAYWRIGHT_MODULE CHROME`
   with the desired revision, first `b6eb8757` and then the
   milestone commit.
