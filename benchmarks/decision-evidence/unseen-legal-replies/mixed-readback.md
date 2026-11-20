# Separate pawn purpose in a tactical decision

Replaying v59 through the worker on the earlier 72-game classical
audit produced one new capture-order explanation. The existing
blind reference calls `45...Bf2` mixed. It has one reviewer. The
older worker calls it unclear. The new worker explains the
tactics and supports only the tactical dimension.

After `46.Rh5`, Black should play `46...Bxe3 47.Kxe3 47...Rxb6`.
The immediate `...Rxb6` allows `Bxf2`, taking the piece that was
about to remove the defender. In a separate both-orders search,
Stockfish corroborates the exact role of that defender.

After the competitive `46.Bg5`, the original bishop moves from e3.
At both 5.4M and 8M nodes the search continues `...Bxb6`, taking the
same advanced passed pawn with a different piece and without taking
the original defender. The `Bg5` replies are 13 centipawns below
the leading reply for White in each of the two searches. Separately,
the captured pawn is a passer by its original structure. The two
continuations support a strategic interpretation about removing
that particular passed pawn. They do not establish how much of
Stockfish's evaluation comes from that feature.
[Chilean league game](https://lichess.org/broadcast/interclubes-apertura-102-club-de-ajedrez-de-chile-2026/ronda-4/mmBAP7Od/JUImU3OB)

The prototype tracks the original passer and guard across distinct
responses. It checks whether a competitive response leads to the
passer's removal without first removing the guard. Four of 55
verified recorded orders from two additional cohorts involved an
already advanced opposing passer. None of those four supplied the
same independent route twice. This limits the finding to the
reviewed development example. Keep the positional interpretation
experimental while broadening independent labels.

[Original blind review](../current-classifier-audit/classical-reference.json) ·
[Worker and deeper readback](mixed-results.json)

## Reproduce

The [classical audit](../current-classifier-audit/README.md) describes
the cached 72-game frames. Run the [v59 worker replay](../cached-capture-selection/README.md)
on those frames with its committed baseline. Use the v59 output's
proved order as the discovery input. Copy its `proposal` to
`candidate` and supply `label: "positive"` so the probe can pick
the verified order. Supply the two older exact-reference cohorts as
controls. Each inputs-and-reference pair must use the same game IDs.

```powershell
$bench = 'benchmarks/decision-evidence/unseen-legal-replies'
python "$bench/mixed_verify.py" $stockfish mixed-results-raw.json $broadFrames $broadOrders $firstCommon $firstReference $secondCommon $secondReference
```
