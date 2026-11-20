# Played moves that line up two pieces

The reviewed `20.Bh4 Qh7` decision exposed a gap in the three-scope
classifier. The queen wins the knight on h5 or the bishop behind it
on h4 in different continuations. After `20.Qc1 Qh7`, White has
`21.Nxf6 Bxf6 22.Bxf6 Nxf6` and avoids the material loss. The
position's best move or its available tactics supply insufficient
evidence by themselves. [Exact original searches](../current-classifier-audit/classical-counterfactuals.json)

## Experiment

The geometry control looks for a quiet bishop, rook or queen reply
with two opposing major or minor pieces on the same ray. The played
move must place one of those two pieces. The front capture must
be legal if the opponent makes no intervening change. This is a
nomination for analysis. The rear piece may be safe, a defenders'
counterattack may refute both captures, or the whole alignment
may have no effect on the earlier decision.

The first candidate requires a paired root comparison, an
independent reply search, and one material loss linked to the
original attacking piece and a specific original target. The
same opponent reply must leave the material balance essentially
intact in the better branch at the compared horizon. The second
candidate asks for the loss in both independently searched
played continuations. The third asks for different defensive
choices and different original victims, so the two lines show
both sides of the alignment rather than an incidental target.
All three compare the material change after allowing an immediate
recapture and require the stronger choice to break the alignment.

A development false positive showed why comparing balances only at
the end of a few plies is too coarse. After `Qc4 Bd5 Qf1 Bxb3`,
`Nxb3` trades bishop for bishop. The queen takes a pawn on c3
later. That pawn cannot supply the payoff for the claimed skewer.
The revised candidate requires a loss immediately after the
target is taken and the defender gets a turn to recapture. A
separate later checkpoint checks whether that local loss persists.
[Development lines](development-results.json)

## Data

The sample uses classical broadcast PGNs with declared clocks of
at least 60 minutes per side. It preserves the full move history
before each decision. The regular ray cohort is selected from
board geometry and the moves actually played. The enriched
cohort requires the recorded game to contain an early material
loss associated with the same attacking piece. These inputs
enrich the test and do not set its reference labels. Ordinary
controls are drawn separately. No position score, model output
or classifier output is used in selection. The groups use event
families, game prefixes and colour-normalised positions to keep
the packets separate. Some source broadcasts were used in earlier
experiments. The earlier played-move diagnostics and 72-game audit
are explicit exclusions.

The [frozen sample](sample.json) records source hashes, quotas
and the exact selections. The course collections and player game
libraries are outside this targeted transfer test.

## Held-out comparison

The second group contains 189 decisions from 58 event families,
including 53 selected by a recorded early capture and 40 ordinary
controls. One engine-assisted reviewer labelled 51 exact questions
before inspecting classifier outputs. The reference covers the
original slider's direct material gain from an aligned piece.
Other mechanisms, including a relative pin that lets a different
attacker win material, are outside that endpoint.

| Method | Correct on 8 positives | False calls on 32 negatives | Calls on 11 unresolved |
| --- | ---: | ---: | ---: |
| Alignment and comparable root loss | 7 | 6 | 6 |
| One played continuation with a material payoff | 1 | 1 | 1 |
| Two played continuations with a material payoff | 1 | 1 | 1 |
| Both losses must survive the immediate recapture | 1 | 0 | 1 |
| Different defences must cost different pieces | 0 | 0 | 0 |

The lone new candidate match is `...Qb7 Ba6` followed by
`Bxc8` for the exchange. The existing classifier already
explains the tactical error by comparing the same reply after
`...Qa8`. Exact-reply collection required 16 extra engine
queries across the 189 replay inputs, totalling 14.7 million
nodes in the last complete frames. The narrower local method
did not earn integration. These numbers address one mechanism
on a targeted sample and are too small to estimate general
tactical recall. [Sealed reference](reserve-reference.json) ·
[Scores and lines](reserve-results.json)

### Follow-up after opening the reserve

The strict comparison rejects a reply when its score after the
better move is far from that move's unconstrained score. Four
misses show why that is too symmetric. The better move can make
the same attacking reply much worse for the opponent, sometimes
by allowing a concrete countercapture.

Allowing refuted replies in the *better* branch raises the local
two-search method from one to five of eight checked positives
with zero calls on the 32 negatives and one unresolved call.
It identifies a new tactical classification after `...Rd6 Bf4`
and an earlier cause after `...Re8 Bc6`, where the existing
report cites a later pawn capture. This comparison reused the
opened reserve. It needs independent transfer before use in the
app. [Follow-up results](refuted-reply-results.json)

## Existing classifier correction

The run exposed an attribution defect in the existing named
skewer detector. It tied a legal rear-piece capture to a tactical
mistake using the subsequent line's overall material balance.
The updated detector checks the capture's legal local exchange
before it can support a skewer. This makes the `Qc4` diagnosis
unclear at this search budget. It keeps the evaluation loss.

The held-out `...Rf6 Bg5` case also showed a skewer based on
an equal trade. The correction keeps a separately witnessed
defender removal, `Bxe7 Rxe7 Qxd6`. Both reports retain their
played-move evaluation losses. No extra engine searches are
needed for this correction. The rendered evidence was checked
with recorded Stockfish frames at 320, 390 and 900 pixels.

The correction changed one report among 90 development requests,
one among 189 held-out requests, and five among 1,875 archived
requests. Six archive requests remained unavailable. The five
archive changes all involve a legal recapture that cancels the
claimed material gain. They include `Rfc8 Qd1 Rxc1 Qxc1`,
`Bb2 Rc2 Bxg7 Kxg7` and `Bf4 Qd7 Bxc7 Qxc7`. The last line
still supports deflection because it gives White `Nxd5`.
The two remaining archive recaptures are `Kxb3` after
`Rb6+ Ka4 Rxb3` and `Nxa7` after `Be3+ Kc7 Bxa7`.
The played-move evaluation and availability
were identical on every comparison. The archive's cached worker
median was 76.5 ms before and 77.3 ms after in separate runs.
[Worker comparison](worker-results.json)

An isolated Windows build of `9ebfae26` reproduced the
`...Rf6` explanation using live Stockfish 19. It showed the
3.45-pawn setback and `Bxe7 Rxe7 Qxd6` without the skewer
label. The existing Chilean `...Bf2` analysis still showed
separate tactical and positional support. The scenarios took
12.4 and 6.6 seconds respectively in the isolated app. The type
check, 25 targeted classifier tests and three Python
regressions passed. [Windows receipt](windows.json)

## Reproduce

From the repository root, use Python with python-chess and the
same Stockfish 19 binary as the [classical audit](../current-classifier-audit/README.md).
`freeze.py` takes the source index stored in the sample, the parent
directory of the listed PGNs and the two exclusion archives specified
in the sample. Save the source array as a JSON file when regenerating
the selections. Use the committed sample directly for the engine
comparison. Stockfish fixed-move searches constrain only the moves
explicitly listed at the root of each search. [Stockfish UCI documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html)

```powershell
$bench = 'benchmarks/decision-evidence/shared-ray-mistakes'
python "$bench/capture.py" "$bench/sample.json" development app $stockfish dev.json
python "$bench/capture.py" "$bench/sample.json" enrichedDevelopment app $stockfish dev-enriched.json
python "$bench/ray_review.py" dev-preview.json dev.json dev-enriched.json
python "$bench/capture.py" "$bench/sample.json" reserve app $stockfish reserve.json
python "$bench/capture.py" "$bench/sample.json" enrichedReserve app $stockfish enriched-reserve.json
python "$bench/verify_exact.py" $stockfish review-reserve.json reserve.json enriched-reserve.json
python "$bench/score.py" "$bench/reserve-reference.json" reserve-baseline.json reserve-scores.json reserve.json enriched-reserve.json
```

To repeat the post-review comparison, pass `--allow-refuted-reply`
to the last command with a different output path.
```powershell
python "$bench/score.py" "$bench/reserve-reference.json" reserve-baseline.json refuted-scores.json reserve.json enriched-reserve.json --allow-refuted-reply
```

The worker baseline uses revision `c62e78f0`, the same frames
and the [replay config](replay.config.mjs). Set `INTERFERENCE_MODE=archive`,
`INTERFERENCE_INPUT` to the combined frame array and
`INTERFERENCE_OUTPUT` to the chosen result path. Omit an empty
`comparisonCandidates` array, as the normal app does when no
comparison was requested. Set `RAY_EXCHANGE_GUARD=1` to overlay
only the revised skewer check on the baseline. Use
`test_ray_review.py` and `tacticalSequenceEvidence.test.ts` for
the local regressions. Run `verify-panel.mjs` with Playwright's
`index.mjs` and the Chrome executable for the rendered check.
Use `compare_worker.py OUTPUT BASELINE GUARD` for each pair of
worker outputs. The archive frames are from the existing
[played-move replay](../allowed-route-mistakes/README.md).
