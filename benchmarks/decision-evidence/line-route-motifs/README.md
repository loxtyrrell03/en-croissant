# Deflection and clearance in Stockfish lines

The live study panel can show which defender left its duty or which
piece vacated an essential square. It follows the route to an actual
mate or material payoff. The annotation names the relevant moves and
the line it applies to. A different defence can produce a different
result.

The first experiment targeted four reviewed deflection misses and two
course clearance misses. Tracing the accepted offer and the recovered
piece found all four deflections, including one in a locally accessible
Woodpecker exercise. A second rule restored the departing friendly
piece on the entry board to check whether the path needed that square.
It found one of two course clearances. In the other exercise Stockfish
gave a different continuation from the course solution. The course
positions and game archive are retained in the local research workspace.

## Frozen transfer results

The new sample uses 56 distinct Lichess source games excluded from
the earlier neural corpus. Sampling deliberately enriches for two
puzzle tags and two visually plausible negative strata. Both arms saw
the same scored Stockfish 19 frame. The reference was sealed before
opening replay output. An independent legal replay supplied concrete
witnesses. Tagged examples with no established exact-line witness were
left uncertain. Controls with no witness were treated as negatives
under that rubric. Puzzle tags can cover the whole solution, so this
is a test of agreement about the root move in the scored line.
[Source and split protocol](protocol.json)

| Root motif | Baseline TP / FP / FN / TN | Candidate TP / FP / FN / TN | Unknown |
| --- | ---: | ---: | ---: |
| Clearance | 0 / 0 / 10 / 33 | 9 / 0 / 1 / 33 | 13 |
| Deflection | 4 / 3 / 1 / 38 | 4 / 3 / 1 / 38 | 10 |

After prediction, a separate board review reclassified four deflection
cases. Two older detections have legal mating mechanisms the initial
reference missed. One older label applies to a different defence than
the scored line, so its exact-line result is uncertain. One new label
correctly explains why an offered bishop opens the f-file. With those
revisions the deflection scores are 6 / 0 / 2 / 38 and 7 / 0 / 1 / 38.
These corrected scores are exploratory. One reviewer and a curated
sample limit conclusions about general game-wide precision.
[Frozen labels](reference.json), [follow-up reviews](adjudications.json), [counts and timing](results.json)

In the archived game replay, all 1,050 valid decision reports matched
exactly. One invalid request remained invalid. The live scan changed
on 20 requests, with 14 clearances and six deflections. The new check
uses existing lines and adds zero Stockfish searches. Median scan time
was about 77 ms for each arm on the 56 puzzles. The source-built panel
showed and expanded the checked continuations at 320, 390 and 900 px.

## Scope and examples

- In `Qxh7+ Rxh7 Rxc8+`, the rook leaves c7, opening c8. The
  continuation recovers the offer with `Rhxh7` seven plies in.
  [Deflection example](https://lichess.org/training/001h8)
- In the missed clearance, `Nc5+` frees b7 for `Rb7`. The rook
  collects the queen only after an intervening friendly move.
  The current material verifier abstains on this longer route.
  [Missed clearance](https://lichess.org/training/1BrDn)

Line annotations do not promote alternatives, count as an immediate
tactical opportunity, or establish why a played move was a mistake.

## Reproduce the comparison

Run from the repository root. Set `LINE_ROUTE_REVISION` to `a3cc7e27`
for the baseline and to the committed candidate for the second run.
Set `LINE_ROUTE_OUTPUT` to a different new JSON path each time.
The replay uses the frozen frames in [reserve.json](reserve.json),
so it needs no Stockfish process. Use `LINE_ROUTE_INPUT` to replay
the public development examples separately.

```sh
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/line-route-motifs/vitest.config.mjs
python benchmarks/decision-evidence/line-route-motifs/score.py before.json after.json
```

For the archived worker comparison, set `LINE_ROUTE_ARCHIVE` to
the saved `reply-coverage-audit/full-pair-input.json` in the classifier
research workspace. Run both arms as above, then pass `--archive` to
the scorer. The outputs compare full worker reports and the live
motifs used to build them. The frozen public puzzle replay and source
regression tests do not require the private archive.
