# Separate positional evidence after a tactical capture

After 11...Qb6+ in public Lichess puzzle [00Nf5](https://lichess.org/training/00Nf5),
both Stockfish lines show the queen taking the original bishop on b2.
Winning the bishop also removes the bishop pair. v47 counted each
description as a separate reason for the move and reported Mixed.
v48 reports Tactical and keeps the bishop-pair observation in the details.
The evidence for Stockfish’s continuation and the interpretation of the
structure remain visible.

The rule follows the original captured piece in both searched lines.
It checks whether that capture creates the observed pawn structure, opens
the file, or removes one of the two bishops. The incremental gain must
survive recaptures on the square and persist through the next two plies.
An identified tactic and a corroborated capture are both required. A
balanced exchange ending before an unrelated later win keeps its positional
evidence. A quiet advance by the newly passed pawn or demonstrable use of
the opened file in both lines can support a separate plan.

## Matched replay

| Sample | Games | Geometry-only verdict changes | Material-only mixed to tactical | v48 mixed to tactical | v48 mixed with a separate factor retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| First replay | 72 | 28 | 10 | 6 | 3 |
| Second replay | 68 | 21 | 9 | 8 | 1 |
| Frozen final replay | 25 | 11 | 8 | 7 | 1 |
| Changed final cases, twice the engine nodes | 8 | — | — | 7 | 1 |

These public puzzle samples have disjoint games and board/mirror keys.
Their selection strata describe captures and exchanges on the puzzle
solution. The strata do not provide reference verdicts. The first two
replays informed the delayed-recapture and balanced-exchange guards.
The geometry-only prototype moved 18 positional verdicts to unclear across
the three puzzle sets. The material-only prototype suppressed real rook
use in the final set. The shipped version keeps a mixed explanation for
[0I2y3](https://lichess.org/training/0I2y3) after 19...Qxf2+,
where the rook also uses the open f-file. All eight changes in the final
set repeat after a deeper search, including this retained mixed verdict.

The earlier reviewed Woodpecker move sample keeps 20 of 35 tactical
positives and 2 of 9 mixed positives. Positional false positives fall
from three to one among 13 reviewed negatives. Mixed false positives
fall from two to zero among 22 reviewed negatives. The independent
puzzle sample keeps 27 of 47 tactical positives and removes its one
false mixed label among 41 reviewed negatives. These references were
also used in earlier rounds of development.

In the 1,051-request archive, 18 moves and two position verdicts change
from mixed to tactical. One further move changes its explanation and
keeps its verdict. All mistake reports match, and all 26 reports in the
separate prospective classical sample match apart from the version.
The broader review still finds low mixed recall. Position character can
miss a separately useful passer which starts too far back, even when
move justification keeps the factor. The rule is bounded by the recorded
replies and the capture horizon.

## Reproduction and cost

No extra Stockfish calls run in the app. The median worker time in two
matched archive runs was 63.94 ms for v47 and 64.41 ms for v48. The source
panel using recorded Stockfish results was verified at 320, 390 and 900
pixels. The verification includes opening the evidence with the keyboard
and reading the bishop-pair observation.

Use the compact public puzzle corpus from
[neural-motif-transfer](../../../docs/CHESS_DECISION_CLASSIFIER_REBUILD.md#neural-motif-transfer-and-fork-localization), SHA-256
9f3d2bdf595a3eac9f1d4f049f3937c03248bfa5595e3c4709f6b6ee30f1fee0.
The four manifests in [results.json](results.json) give exact public
identifiers and order. Select those rows from the corpus, carrying the
stratum from the sampler. To generate fresh analogous sets, use
`sample.py CORPUS DEV.json HOLD.json EXCLUDE...`. Use `-` for DEV if
drawing an additional reserve, and include previous splits and the
archive in the exclusion list.

From the repository root, run
`interference-in-line/prepare.py search INPUT SCORED STOCKFISH HELPERS --nodes 1200000`
with that script's full repository-relative path and
`benchmarks/decision-evidence/defence-after-attack` as HELPERS. Double
the node limit for the deeper manifest. Use Stockfish 19 with engine
SHA-256 45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0.
Engine inputs include timing metadata, which can vary across runs.

Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/capture-structural-dependence/vite.config.mjs`.
Set `CAPTURE_EFFECT_INPUT` to the scored frame file and
`CAPTURE_EFFECT_OUTPUT` to a new output path. Leave `CAPTURE_EFFECT_ARM`
unset for v47. Use `geometry`, `material`, or `product` for the candidate
arms. Set `CAPTURE_EFFECT_PRODUCT_REV` to the v48 milestone commit for
the production assessment. The two early prototype replays predate the last
verification guards. The final frozen comparison runs all arms with the same
finished helper.

The final script `score.py LAB AUDIT HISTORICAL OUTPUT` reads the
`*-base.json`, `*-geometry.json`, `*-material.json` and `*-product.json`
outputs for the public manifests. The AUDIT directory holds the v47
and product outputs for `archive`, `prospective` and `early`.
The HISTORICAL directory supplies older label and input files referenced in
the [cross-scope audit](../current-classifier-audit/README.md).
Private game frames and course data stay in their local stores. Four
public engine fixtures support the regression tests. To check the panel,
run `node benchmarks/decision-evidence/capture-structural-dependence/verify-panel.mjs PLAYWRIGHT_MODULE CHROME`.
