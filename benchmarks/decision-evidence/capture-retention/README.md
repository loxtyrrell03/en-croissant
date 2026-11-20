# Keep an early capture separate from a later recapture

A short material difference can disappear when the original collecting
piece is taken a few moves later. In the Sants game, 39...e5 40.dxe5
initially wins a pawn in both comparisons. The normal paired search
later plays ...Nxe5. Both deeper lines play 42...Nxe5. The earlier
worker called the mistake Mixed and claimed a material win after three
plies, before the recapture. The worker now keeps the observed
advanced-pawn factor and omits the unsupported tactical claim.
[Sants game](https://lichess.org/broadcast/xxvii-open-internacional-de-sants-ciutat-de-barcelona-2026-group-b/round-3/NGzf6WAR/LPcPGUXM)

The new generic capture check tracks the piece that made the advertised
capture. If it remains on that square and the recorded defending side
later recovers enough material by taking it, the early gain cannot
justify this explanation. The legal exchange check includes immediate
recaptures of the collecting piece. Both played branches continue to
use their own exact provenance. The named motif verifiers still use
their separate proofs. One pawn's recapture cannot explain losses
from a different tactical mechanism.

## Matched replay

| Worker comparison | Requests | Tactical or mixed category changed | Result |
| --- | ---: | ---: | --- |
| Fixed later settlement | 622 | 3 | Adds one candidate and drops an established rook explanation at two budgets |
| Track the original collector, prototype | 622 | 1 | Sants Mixed to Positional |
| Track the original collector, production | 622 | 1 | Sants Mixed to Positional |
| Production, previously reviewed archive | 1,051 | 0 | 1,050 usable reports |

The fixed later window waits at least six plies before measuring a
capture. It still calls Sants Mixed because a separate gain qualifies
the wider material total. It misses the confirmed ...Rxg3 Rxg3 rook
exchange in the Polish game at the original and doubled node budgets,
where the exact follow-up varies. The tracking version retains the
rook explanation and matches the deeper Sants classification.
[Polish game](https://lichess.org/broadcast/polish-team-championship-2026-division-1-druzynowe-mistrzostwa-polski-i-liga/round-9/9eyzPy9m/BcNRqWwO)

The direct route replay covers 889 paired inputs from the 1,875-request
archive. Sixteen candidate explanations change, four are added
and three are removed by the fixed later window. Tracking removes
one unsupported alternate material claim in the Lebanese case and
points to the actual later ...Nxh4 bishop capture in puzzle 1wMuo.
The full worker independently explains both mistakes. In the Lebanese
game the knight checks still create concrete tactical danger after
...Nf4. These comparisons give no estimate of general tactical
precision or recall.

No extra engine queries run in the app. The worker's archive median
is 64.79 ms before and 65.50 ms after, excluding the engine and browser.
The case replay uses 13 plies. It does not cover returns after the
collector moves away, later positional consequences, or all ways
to compensate a material loss. The source-built panel was checked
with both revisions at 320, 390 and 900 pixels using the recorded frame.
The installed executable remains outside this verification.

## Reproduction

The [receipt](results.json) records data identities, exact report
changes and elapsed worker times. Regenerate `capture-retention-input.json`
by appending the [reply-concordance](../reply-concordance/README.md)
matched inputs, the 160-game scored reserve, and the two held-out-depth
controls from [fixtures.json](fixtures.json) re-scored at 4.8M root
and 2.8M reply nodes with the same Stockfish 19 binary. Add `:deeper`
to the ID of each appended depth control. Keep the Polish record first
and the Sants record second for the two depth controls.

From the checkout root run
`node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/capture-retention/vite.config.mjs`.
Set `REPLY_CONCORDANCE_INPUT` and `REPLY_CONCORDANCE_OUTPUT` to the
scored input and an unused output path. Leave `CAPTURE_RETENTION_ARM`
unset for the baseline. Use `late`, `tracked` or `product` to compare
the candidates. In product mode set `CAPTURE_RETENTION_REVISION` to
the capture-retention commit. For the scoped 889-pair run, set
`CAPTURE_RETENTION_ROUTE_ONLY=1` and use
`allowed-route-mistakes/inputs.json`. The full archive worker run uses
`reply-coverage-audit/full-pair-input.json`.

Use the `capture-retention-*.json` and `capture-archive-*.json` output
names in `score.py`. Save the production archive worker output as
`archival-product-product.json` and run `score.py RUN_DIRECTORY LAB OUTPUT`.
Check the two direct regressions in `src/utils/tests/decisionCaptureRetention.test.ts`.
The rendered check is `node benchmarks/decision-evidence/capture-retention/verify-panel.mjs PLAYWRIGHT_MODULE CHROME`
with `CAPTURE_RETENTION_REVISION` set to the desired revision.
