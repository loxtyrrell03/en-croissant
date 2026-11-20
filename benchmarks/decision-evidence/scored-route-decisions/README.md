# Using corroborated tactical routes in Decision Evidence

The live motif panel could already show a checked deflection or clearance
in a single Stockfish line. The decision worker treated those annotations
as observations. That left some moves with an exact causal explanation in
the live panel and an unclear decision report for the same move.

Decision assessment v42 uses the same route checker. The leading root
line and a separately searched leading reply must agree on the score and
the same mechanism, including its relevant squares. The report retains
the exact legal line through the closing recaptures. A material
clearance or deflection must improve
the material balance at the claimed payoff, survive the same-square
recaptures, and retain the gain in the continuation. A legal mate is
also a payoff. Other replies can change a route. The evidence remains
scoped to the demonstrated defence.

The stronger check distinguishes opening a path from benefiting from
using it. In a Polish Open position, `19.bxa4 Qa5 20.Nb3 Qa6 21.Nxc5
dxc5` genuinely clears b3. The knight trade keeps the pawn won on the
first move and adds no material. A looser variant treated the trade as
a tactical payoff and turned a positional report into mixed. v42 leaves
that positional verdict in place.

When the same tactical capture directly removes a bishop or a pawn,
the loss can appear again as lost bishop pair or an isolated neighbour.
Without a separately useful comparison or a balanced material window,
the report keeps the board effect as an observation and marks its
strategic importance uncertain. Other supported positional factors
can still produce a mixed verdict.

## Results

The 56-puzzle reference from the existing route study was frozen before
the earlier live-motif experiment. This comparison scores the exact
named **move explanations in Decision Evidence**, including verified
root certificates. The live motif panel already had its separate
single-line annotations. The held-out reference describes named
mechanisms in the specified lines. An unknown label stays outside the
precision and recall denominators.

| Root motif | v41 TP / FP / FN / TN | v42 TP / FP / FN / TN | Unknown |
| --- | ---: | ---: | ---: |
| Clearance | 0 / 0 / 10 / 33 | 6 / 0 / 4 / 33 | 13 |
| Deflection | 3 / 1 / 2 / 40 | 3 / 1 / 2 / 40 | 10 |

The two additional 36-puzzle samples have separate game and
colour-normalised board identities. Each uses 12 clearance-tagged, 12
deflection-tagged and 12 other puzzles from a retained public corpus.
The root move receives its own fresh Stockfish score and its opposite-side
reply is searched independently. The tags are sampling strata.
The same game never contributes to both samples. For these tests the
root move is supplied, so they measure evidence for that move and do
not estimate the overall character of a position from competing choices.
The second sample was held back until the tactical payoff rule was
chosen. Its bishop-pair example informed the final strategic guard,
so the related positional change remains exploratory.
An independent legal board replay checked the route and settled
material or mating outcome for all 18 new explanations.

| Replay | New named explanations | Moves gaining tactical support |
| --- | ---: | ---: |
| 52 retained Woodpecker exercises | 3 | 1 |
| 48 retained independent puzzle moves | 7 | 1 |
| 56 frozen motif exercises | 7 | 1 |
| First fresh scored sample, 36 games | 9 | 2 |
| Second fresh scored sample, 36 games | 9 | 2 |

The archive compares 1,051 requests, including the ordinary positions,
recorded mistakes and earlier exercise evidence. Counts across the
archive and the retained exercise cohorts overlap. The archive
mistake reports agree, with the usual cache version update. The full
counts, earlier variants and case-level public continuations are in
[results.json](results.json).

## Examples and limits

- **Quiet clearance.** `30.Ng4 Rg8 31.Rf7 Rg7 32.Rxe7` vacates f6 so
  the White rook can reach f7. Taking the queen and allowing the rook
  recapture still leaves the side to move four material points ahead
  relative to the starting material. [Exact fixture](fixtures.json)
- **Deflection with a material payoff.** `28...Rd1+ 29.Rxd1 Qxc4`
  moves the rook off c1 so it cannot recapture on c4. Decision Evidence
  now explains the offer and queen capture. [Exact fixture](fixtures.json)
- **Overlap with a structural change.** `17.Rxe7+ Qxe7 18.Qxa8+`
  deflects the queen. The opening capture also removes the bishop pair.
  The verified tactical report keeps the long-term effect of that
  removal uncertain in this line. [Exact fixture](fixtures.json)

The repeat-only variant and the leading-reply variant recover the same
three tactical diagnoses on the 156 cached exercises. Adding names to
already-tactical moves recovers further reviewed clearances. The retained
payoff check rejects the Polish example without removing either of the
first fresh sample's new tactical verdicts. The stricter arm requiring
two quiet moves loses the f-file deflection after `...Bxg2` in one
search because checks continue after the gain. The final check accepts
the actual settled exchange and two following plies that retain it.
These examples informed the guard and are kept as explicit regressions.

The proof adds zero Stockfish searches in normal Decision Evidence
use. Cached worker medians on the archive were about 67 ms for v41
and 63 ms for v42. The first enriched puzzle sample took about 82 ms
and 104 ms, respectively, in the recorded runs. A later payoff
beyond the proof window, an incoherent reply search or a different
defence can still leave the mechanism unestablished. Mistake recall
and broader mixed recall require separate evaluation.

## Reproduce

Use Stockfish 19 with SHA-256
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`,
the project dependencies, Python with python-chess and the retained
classifier research directory. Each fresh case uses 2.4 million nodes
with the root move fixed, followed by 4.8 million nodes for the replies.
The engine runs one thread and 64 MiB hash.

1. Use `prepare.py cached RESEARCH cached.json` and
   `prepare.py archive RESEARCH archive.json`. Use
   `prepare.py reserve RESEARCH reserve-scored.json --engine STOCKFISH`
   and repeat for `holdout-scored.json` with
   `--exclude reserve-scored.json`.
2. Set `ROUTE_INPUT` and `ROUTE_OUTPUT` to the corresponding paths.
   Run `vitest run --config benchmarks/decision-evidence/scored-route-decisions/vite.config.mjs`.
   `ROUTE_ARM` selects baseline, leading-reply, repeated,
   named-repeated, separated or settled. For the integrated worker set
   `ROUTE_ARM=release` and `ROUTE_REVISION` to the v42 commit, and name
   its result `*-final.json` for scoring.
3. Use `score.py RUN_DIRECTORY results.json` and its listed arm names
   to compare exact reports. Run `decisionLineRoutes.test.ts` for the
   wrong-board, material attribution and strategic overlap regressions.
   `verify-witnesses.py BASELINE FINAL` independently replays the added
   named witnesses and checks their route and material or mating payoff.
4. Run `node verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE`
   from the repository root with the script path and v42 revision.
   The source-built panel showed the tactical verdict and expanded
   the exact line at 320, 390 and 900 px.
