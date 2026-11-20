# Does a strategic move need to happen now?

Decision Evidence already explains some shared strategic plans. It rarely
compares the timing of a specific action with the best legal alternative.
This offline experiment develops that comparison for quiet passed-pawn
advances, rook activity on a file without a friendly pawn, and
pawn-supported knight outposts. It keeps position character,
exact move justification and played mistakes separate.

The original small screen found 12 of 1,785 preview positions and no
supported contrasts. The revision also covers quiet fifth-rank passer
advances and deeper rook moves on an already occupied file. It records
shape and actual PV retention separately. This gives useful controls
where the exact-looking plan fails to persist or ceases to lead.

At each reached board, the probe first checks whether the idea still
leads in an unrestricted search. It searches the best legal move outside
that move family, then scores the exact pair together at the same
completed MultiPV depth. The separate searches sometimes put the
restricted alternative above the unrestricted leader. Only the paired
search supplies the reported score difference. The 55-centipawn screen
requires the original actor and idea to persist with settled material.
It records whether the alternate line carries out the same plan later
with the same piece. Even a repeated difference measures the choice
on the reached board. It cannot allocate all of the score difference
to the named strategic feature.

## Results

| Stage | Cached development | Full public sample | After source audit |
| --- | ---: | ---: | ---: |
| Root requests | 1,785 | 96 | 66 |
| First principal line nominates a checkpoint | 78 | 27 | 17 |
| Original preview shows persistence | 27 | 12 | 8 |
| Passes the paired contrast at depth 16 | 5 | 3 | 2 |
| Passes the paired contrast at depth 20 | 3 | 3 | 2 |
| Same exact option passes at both depths | 1 | 3 | 2 |
| Repeated options on positions the app left without positional support | 0 | 0 | 0 |

The sampler excluded known game identities, mirrored positions and event
IDs before scoring. A later audit rematched the public PGNs to resolve
older cases with shortened event IDs or missing histories. It found
ten selected games that visit an archived board and 23 selections with a
shared event family. Excluding their union leaves 66 games across 20
families, including the Kenya and NATO examples. The European Youth
finding below is an exact example from a shared event family. The
post-analysis exclusion is a sensitivity check with the rules held fixed.
[Source overlap audit](split-audit.json)

The deeper arm measures all checkpoints, so both improvements and
reversals are visible. The public sample is enriched for the three
actions and includes controls where a geometric option exists but was
not played. The reported timings exclude the original root analysis.
For the 27 public checkpoints the extra searches use a median of
0.44 million nodes and 0.54 s at depth 16, and 2.47 million nodes and
2.08 s at depth 20. Node caps occasionally prevent a matched scoring
frame in the archive. The engine and exact paired results are recorded.

## What the lines show

- **Kenya National League.** After 43...c3 White can advance with a5.
  Black has time for ...Bd7 before the a-pawn gets to a6. The 43...Kf6
  line still plays ...c3, while White plays a6 before the bishop gets to
  c8. The paired depth-20 scores are +1.70 and 0.00 for Black. The current
  position report already explains the lasting passed pawn. The comparison
  adds concrete evidence about when to advance it.
  [Game](https://lichess.org/broadcast/kenya-national-chess-league-2026-premier-league/round-2/WT4yuPmA/HCteHFd1)
- **NATO Championship.** 30.Rb6 and 30.Qf3 both lead to the original rook
  on b6. At depth 20 the paired values are −0.80 and −1.96 for White.
  The app already identifies the shared b-file plan in the position
  report. The candidate report lacks a specific reason. The search
  supports a timing comparison and leaves open how much of the difference
  comes from the queen's placement.
  [Game](https://lichess.org/broadcast/36th-nato-chess-championship-2026/round-5/Zipw7lXe/0YRAbS32)
- **Amsterdam.** After 50...Bxe5 51.dxe5, ...d4 still scores ahead of
  ...Kxe5 in the earlier direct comparison. Adding the best choice outside
  the immediate pawn advance finds ...Bf5. At depth 20, ...Bf5 and ...d4
  both score +0.80 and the ...Bf5 line later plays ...d4. That supports the
  passed-pawn plan without requiring the immediate push.
  [Previous exchange benchmark](../settled-exchange-plans/README.md)
- **European Youth six-piece ending.** The tablebase confirms that
  Rg6, Rg7 and Rg8 alone draw. Rg5 loses immediately to ...Rxg5 and
  Rg3 to ...Kxg3. Kf1 allows ...e2+ and Rd4 allows ...Kg3. The current
  report explains activity on the g-file and misses the exact defensive
  constraint. Settled material in a short line alone can let a tactical
  or promotion consequence through a strategic screen.
  [Game](https://lichess.org/broadcast/european-youth-chess-championship-2026-o18/round-6/B7IXGP6j/OrZik0ID) ·
  [Tablebase response format](https://github.com/lichess-org/lila-tablebase#http-api)

An independent exact-outcome check on 18 available public endings verifies
every legal move. The cached leading Stockfish move retains the best
outcome in all 18. Two MultiPV lists contain lower-ranked moves with
worse exact outcomes. The stored actual move retains the best outcome
across the sample, so it cannot test missed losing played moves.

The comparison stays offline. It yields timing evidence and exposes one
exact defensive gap, with no demonstrated increase in broad position
recall. Position- and mistake-axis precision require separate reviewed
labels.

## Reproduce

Use python-chess and Stockfish 19 (SHA-256
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`).
The cached input and baseline are `settled-exchange-plans/base-input.json`
and `settled-exchange-plans/full-product.json` in the task's
`classifier-rework` directory. The transfer uses the checked-in frozen
public sample. The sample builder reads the retained PGNs in place.

1. Use `transfer.py score SAMPLE STOCKFISH ROOTS` to obtain the
   transfer root input. Run `probe.py screen INPUT CHECKPOINTS`.
2. Run `probe.py compare CHECKPOINTS RESULTS STOCKFISH 16 680000` and
   again with depth 20 and a 2,600,000-node cap per query. Reuse the
   settled-exchange test runner with `SETTLED_EXCHANGE_FULL=1` and
   `SETTLED_EXCHANGE_REVISION=ca1f781f` for the transfer baseline.
3. Run `score.py DEPTH16 DEPTH20 BASELINE INPUT SUMMARY` for each cohort.
   The result contains legal SAN readback, paired scores and runtime.
4. Run `tablebase.py OUTPUT ARCHIVE TRANSFER` for the exact public
   endings. It checks every returned legal move and orients each result
   to the root mover. The example reply search positions are also saved.
5. Run `audit_split.py LAB ARCHIVE SAMPLE CACHED_CHECKPOINTS OUTPUT` to
   reproduce the source exclusions. Run `test_probe.py` for the cases
   covering deferral, a blocked pawn and the quiet rook moves.

[Cached comparison](archived-results.json) · [Public comparison](transfer-results.json) ·
[Exact outcomes](tablebase-outcomes.json) · [European Youth replies](tablebase-replies.json)
