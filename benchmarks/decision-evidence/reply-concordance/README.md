# Matching a close reply across separate searches

The mistake report normally corroborates the paired search against the
top reply from a separate search. Those searches can disagree on which
reply to lead with. This experiment lets the existing tactical and
positional verifiers use the paired line's reply when the same move
appears among the alternatives in the separate search.

The alternate must be on the existing validated reply frame, at the same
depth as the leader, and close enough in score to that leader. It must
also agree with the paired evaluation within the existing 90-centipawn
tolerance. The original mechanism runs first. The prototypes are
applied only to unresolved checks, with all positions and moves replayed
through the same Decision Evidence worker.

## Results

| Arm | Changed mistake reports on 460 matched inputs | Verified new diagnoses |
| --- | ---: | ---: |
| Positional comparisons, 65 cp | 0 | 0 |
| Tactical comparisons, 65 cp | 1 | 0 |
| Both, 65 cp | 1 | 0 |
| Both, 35 cp | 1 | 0 |
| Played reply only, with a legal recapture check, 35 cp | 0 | 0 |

The 460 requests consist of 199 paired archive cases, 115 from the
alternate-capture public transfer, 127 from the outpost reserve and 19
paired requests from the prospective audit. At 35 cp there are 102
requests with an alternate matching at least one root's paired reply.
At 65 cp there are 115. These counts describe the input frames.
Corroboration and the individual mechanism gates narrow them further.
No original position or exact-move verdict changes.

We froze a further 160 public classical games from 34 PGN files. Each
supplies one annotated decision from a different game, with board and
colour-mirror collisions removed against the listed exclusions. The
selection favours positions where two legal captures exist immediately
after the played move, including one that can be recaptured. At the
35 cp gap, 33 inputs contain at least one matching close reply. Both
the combined arm and the guarded arm give the same mistake results as
the baseline. There is no verified transfer improvement. This sample
has no comprehensive manual axis labels.

## The counterexample

In the World Junior game, 20...Nxd4 allows 21.Nxd4. The paired line and
the matching alternate both follow 21...Bf6, so the unguarded arm
asserts that the reply wins material. It uses two agreeing searches and
still attributes the loss incorrectly.

With twice the paired and reply node budgets, both searches of the same
21.Nxd4 branch play **21...cxd4**. The knight is recaptured. A separate
2.8M-node calculation ranks this recapture 65 centipawns above
21...Bf6 for Black at depth 23. White's evaluation is still high after
the exchange. Restricting White to 21.Nxd4 after the stronger 20...cxd4
lets Black take on d4 with the original knight and reverses the
evaluation. That difference does not establish a free knight.
The added legal exchange guard rejects the unsupported material
reason at the original budget. The prototype stays offline.
[World Junior game](https://lichess.org/broadcast/fide-world-junior-chess-championship-2026-open/round-1/5JLs2gkn/Ulkux2f1) |
[Exact frames](world-junior-frames.json) |
[Restricted searches](world-junior-counterfactual.json)

## What deeper frames recover on reviewed mixed mistakes

A prior independent review found support for both dimensions in eight
of 17 historical mixed labels. The other nine retain uncertainty on
one or both dimensions. The historical labels stay frozen for prior
comparisons. The table below asks a separate question about those
eight reviewed cases with the current assessor. The higher-budget
replay uses the saved forced pair and separate leading replies from the
review. It is not a rerun of the app's complete normal search workflow.

| Report | Archived app frames | Saved deeper comparison |
| --- | ---: | ---: |
| Mixed | 1 | 0 |
| Tactical only | 1 | 1 |
| Positional only | 1 | 2 |
| Unclear | 4 | 5 |
| No played-move report | 1 | 0 |

The deeper Grand Swiss frame supplies the previously missing comparison
but still leaves both mechanisms unresolved. In the Asian Disabilities
rook ending the deeper lines recover the positional finding, a pair of
rooks holding up the d3 passer, while they vary in the material route
after the weaker choice. The earlier confirmed en passant example is
classified as unclear on the deeper frames. The paired evaluation
difference drops from 147 to 79 centipawns, and one deeper line removes
the passer in a rook exchange before the required persistence window.
Search agreement, durable strategy, and tactical payoff remain separate
checks. More depth alone does not close the mixed recall gap.
[Original review and exact lines](../promotion-intermezzo/mixed-reference-reviewed.json)

## Reproduction

Run `prepare.py matched LAB OUTPUT` to rebuild the 460 inputs and
`prepare.py deeper_mixed LAB OUTPUT` for the 17 saved re-review inputs.
The assay is pinned to `053ca262` and uses the existing project
dependencies and python-chess. The relevant local paths and input
hashes are in the [receipt](results.json) and preparation script.

Run the worker replay with
`node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/reply-concordance/vite.config.mjs`.
Set `REPLY_CONCORDANCE_INPUT`, `REPLY_CONCORDANCE_OUTPUT` and
`REPLY_CONCORDANCE_GAP`. Leave `REPLY_CONCORDANCE_ARM` unset for the
baseline. Use `positional`, `tactical`, `combined` or `guarded` for the
other arms. Use the output names required by `score.py`. A complete
standalone case replay uses `world-junior-frames.json` as input, with
the guard on or off at 35 cp. Reproduce the restricted checks with
`check-witness.py STOCKFISH OUTPUT`. The Stockfish 19 binary hash is
recorded alongside the searches.

To recreate the 160-game reserve, call
`../alternate-capture-payoff/sample.py OUTPUT LAB 160 EXCLUDE...` from
the repository root with the script's full repository-relative path.
Exclude `reply-coverage-audit/full-pair-input.json`, the 460-case
matched input, `decision-draw-transport/heldout-scored.json` and
`allowed-route-mistakes/standard-fresh.json`. Score these games using
the [draw-aware benchmark's search runner](../draw-aware-search/README.md#reproduction),
with its standard 2.4M root and 1.4M reply nodes. To remake the deeper
World Junior input, score its first frame with 4.8M and 2.8M nodes
respectively and keep the original publicly recorded game history.

The prototypes make no extra queries in the worker. Deeper and
restricted Stockfish searches were run for evaluation only. The matched
archive review uses the `alternate-capture-payoff/archive-product.json`
receipt from the lab. Run `score.py RUN_DIRECTORY LAB OUTPUT` for
the comparisons and the eight verified historical cases.
