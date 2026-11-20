# Prove an avoidable mate in three from the paired search

A short mate used to require agreement on the distance and a complete
separate played-move reply. When the paired search already identified the
attack, the app could still leave the mistake unresolved. In the New York
game, `55.Rxc6 Qxf2+` forces mate in three. The paired search certifies the
same leading alternative at depth 31. The initial search and the separate
played reply complete at depth 14. The earlier report could not use them
to confirm the mate. The new check tests every legal defence to `Qxf2+`.
After `55.Qf1`, the same attempt can be met by `Qxf2`.
[New York game](https://lichess.org/broadcast/10th-annual-new-york-state-girls-championship-2026/round-3/jpy6yHfC/6ygGTxNP)

The verifier starts from the exact played board. It tests the nominated
mating move, including quiet starts, and then every defence. It also
enumerates replies to the scored alternative to rule out another mate
within three. Its published lines replay to checkmate or to a concrete
defence of the same attack. When the actual history could allow a repeated
position, it qualifies the mating proof using that history and all
defender draw claims. Cases with uncertain proof, a wrong board, a
suspect frame or an exhausted budget leave the evidence unresolved.

Only a complete paired search or an independently searched mate score can
nominate an attack in the product. The engine nominates the move. The
local search supplies the proof. When the paired frame is enough,
Decision Evidence keeps the pair, skips the separate played reply, and
still gathers the leading reply for the other parts of the report.
The worker repeats the proof on the frame it receives.

## Matched evaluation

The backing corpus contains 48 development games from 14 event families
and 104 held-out games from 36 different event families. A sample uses
one board per game. It removes matching game histories and
colour-normalized boards from the listed earlier cohorts. The search
reference independently enumerates exact mates using python-chess and
checks the alternative on the same original board. Recorded evaluations
stratify the sampling. They do not set the benchmark labels. A case is
eligible when the engine's leading choice has a finite score and changes
the availability of a mate in three. A forced mate at a longer horizon
is outside this verifier's claim.

| Comparison | Verified positive diagnoses | False calls |
| --- | ---: | ---: |
| Development, old worker with full searches | 8 of 9 | 0 of 39 |
| Development, product with full searches | 9 of 9 | 0 of 39 |
| Held-out, old worker with full searches | 12 of 12 | 0 of 92 |
| Held-out, product with full searches | 12 of 12 | 0 of 92 |
| Held-out, old worker without the separate played reply | 0 of 12 | 0 of 92 |
| Held-out, product without the separate played reply | 12 of 12 | 0 of 92 |

The checked variants consider engine-nominated starts only, nominee plus
other checking starts, or every possible mating start. A fourth
experimental arm checks the shown attack after the stronger move, with
no search of its other mating options. With complete searches those four
arms give the same held-out results. The exhaustive attack search is
more expensive. The selected product uses only the scored nominations
and checks all alternative attacks after the stronger move. A second
source-frame comparison distinguishes the older leading-frame-only
prototype from the version that can use the deeper exact pair.

Every exported held-out proof is replayed independently, including
all legal defences to the exact published attacking move. Two use quiet
starts. The 1,051-request archive has 1,050 usable reports. Position,
exact candidate moves, and played mistakes all agree between versions
on those requests. These are scoped reproductions. General tactical and
mixed recall require their separate benchmarks.

## What the player sees

- At Biel, `...Nxe4` allows the quiet `Qh5`. After `...d5`, the same
  `Qh5` can be met by `...Qxh6+`. The report shows both lines.
  [Biel game](https://lichess.org/broadcast/59th-biel-international-chess-festival-2026-open-masters-mto/round-2/Ps70rBcu/IeYnYEhJ)
- At Copa Revolución, `...f4` allows the quiet `Nd4`. The stronger
  `...g4+` gives check first, so `Nd4` is illegal. In the live Stockfish
  replay the original app path uses four engine queries and 3.20M
  observed nodes. The new path uses three and 2.20M. The elapsed
  times are 2.45 and 1.68 seconds in this local example.
  [Copa game](https://lichess.org/broadcast/xiv-torneo-internacional-y-nacional-de-ajedrez-copa-revolucion-2026-abierta/round-7/bgQIyQF5/lK7g85QZ)

Omitting the held-out played-reply searches corresponds to about
15.2 million nodes in their last completed Stockfish iterations.
The separate browser check uses recorded inputs and the actual worker,
covering keyboard access to both lines at 320, 390 and 900 pixels.
The workflow is source-verified. The installed desktop executable
still needs separate verification.

## Reproduce

Use the [results](results.json), the existing local public PGNs and
Stockfish 19 with SHA-256
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.
The benchmark pins its baseline to `c9e35249`. Use Python with
python-chess and the repo's existing Node dependencies.

1. Run `sample.py LAB RUNS EXCLUSION...`. Exclude, in order,
   `allowed-route-mistakes/inputs.json`,
   `reply-concordance/reserve-scored.json`,
   `current-classifier-audit/prospective-scored.json`,
   `played-short-mate/holdout.json`, and
   `played-short-mate/development.json` from LAB. The script uses
   one record per game and separates event families.
2. Score `development.json` and `reserve.json` with
   [the existing search runner](../draw-aware-search/README.md#reproduction)
   at 2.4M root and 1.4M reply nodes. Save as
   `development-scored.json` and `reserve-scored.json`.
   Run `reference.py SCORED REFERENCE` for each cohort.
3. Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/played-mate-in-three/vite.config.mjs`.
   Set `MATE_THREE_INPUT` to a scored array and
   `MATE_THREE_OUTPUT` to the corresponding unused path.
   Unset `MATE_THREE_ARM` for the baseline, or select
   `nominated`, `checking`, `all` or `product`. The default
   `MATE_THREE_DEFENCE=all` checks all alternative attacks.
   Use `shown` only for the shown-attack experiment.
   Set `MATE_THREE_LEADING_ONLY=1` for the earlier depth-source
   comparison. Set `MATE_THREE_WITHOUT_PLAYED_REPLY=1` for the
   row that omits the played reply. Use `MATE_THREE_REVISION`
   to select the final source in product mode.
4. For the live test, set `MATE_THREE_ENGINE` to the executable
   and rerun with an unused output path. The test exercises the
   app's search sequence with a live Stockfish process through
   its engine interface. Run `score.py RUNS LAB OUTPUT` with
   the output names listed by the script.
5. To check the rendered panel with the saved public cases, run
   `node benchmarks/decision-evidence/played-mate-in-three/verify-panel.mjs PLAYWRIGHT_MODULE CHROME`
   with `MATE_THREE_REVISION` set to the final revision.
