# Retaining a captured pawn through an equal checking exchange

Adapter **120 / live pipeline 125** recovers a concrete missed pawn opportunity
from the same fixed owner-game audit. This is one recall improvement, not
completion of the broad accuracy goal or a replacement benchmark.

## Chess judgement

In the first game's ply-40 position, Qxc6+ takes a loose pawn. The old rule
required another strictly profitable capture after every check evasion, so it
rejected Qd7 Qxd7+ Rxd7: exchanging queens retains the pawn without winning
another piece. The supplied engine line alone is insufficient, because Black
can instead interpose a rook or move the king.

The expanded proof covers all four legal replies. It retains Qxd7+ against
Qd7 and uses Qg2 against the rook interposition and king moves. Those queen
offers preserve the material bound and can answer checks without sending the
king on an unchecked walk. The real proof uses **549 of 8,192 operations**;
its **100-cp local material bound** is not a full-position evaluation.

Fresh unrestricted analysis chooses Qxc6+ at -575 cp for White; holding that
root gives -613. The selected branch answers score -594 to -631. White remains
losing overall. The alternatives are material-retention witnesses, not claims
of optimal play: after the rook interposition, Qc8+ is stronger (-457) than
the selected Qg2 (-607). A local pawn opportunity is not a won-position claim.

The missed-opportunity explanation now identifies that pawn. The preceding
opponent move also captured a pawn, so its comparison remains explicitly
unproved instead of alleging a new net loss. The later queen-winning capture
and a separate game's larger knight-capture lesson retain priority. The
nearby ply-42 capture, whose engine line requires more quiet/checking queen
play, remains unexplained at the root.

## General rule and boundaries

- Existing positive-capture proofs run first. Only their failure attempts the
  new fallback, sharing the same operation budget rather than doubling it.
- The checking piece may exchange for a same-role piece interposed on its
  actual checking ray. Its independently checked exchange gain must be zero;
  a queen-for-rook liquidation does not qualify.
- An actual supplied interposition/exchange may nominate quiet retreats by
  the checker against other evasions. The line nominates the mechanism;
  every legal check evasion still needs an independently checked answer.
- Every answer used by the new fallback, including captures, must retain
  material through immediate liabilities, terminal threats and counterchecks.
  Each countercheck needs a capture or block; the king may take the checker,
  but a quiet king flight cannot supply this extra safety condition.
- A recapture trading the last mating material into an immediate terminal draw
  cannot fund a generic pawn-win badge. Exact saving resources are separate.
- Caches are bounded, diagnostic/custom budgets cannot borrow default success,
  and application deadlines are unchanged. Longer quiet counterplay and
  unrestricted king hunts remain outside these local certificates.
- The headline and arrows describe the root pawn capture, not a future free
  queen or an already-completed exchange.

## Contrary evidence and checks

An initial quiet-retreat draft selected Qc2 against the rook block. Fresh
Stockfish gave -781 rather than the best -457, exposing a much stronger king
attack. A later draft protected only quiet retreats; its simplified exposed-
king example still chose Nxa3 and allowed mate in four. That board is retained
as a negative control in both colours, not removed from the tests. A separately
constructed shielded board supports the positive queen-exchange case. Rook
interpositions, capturable checkers, unequal exchanges, missing nomination and
terminal drawn trades have separate controls. The first proposed simplified
queen interposition was illegal and was corrected before engine validation;
legal replay is now asserted explicitly.

The final **52 fresh depth-16 searches** comprise 22 owner root/branch searches
and 30 constructed/reflected root/branch searches. They are not 52 independent
games. The public constructed receipt is `checking-exchange-stockfish-18.json`;
its test matches the actual selected proof decisions. Owner games, the earlier
rejected witnesses and full private reports remain outside Git.

The final source replay changes two of 217 first-sample result rows: the
opportunity and its preceding move context, not two recovered tactics. All
122 other owner results, 246 private course/generated-game results and twenty
rare-theme results remain unchanged ignoring versions/timing. Unchanged or
empty output is not certified correct. The broad source selection passes
2,384 tests with 169 optional skips; a subsequent 21-check focused run includes
the public engine-receipt assertion and private owner explanation checks.
TypeScript, scoped lint, frontend/shared-review builds and twelve service/cache
checks pass. No new browser automation or native-window interaction is claimed.

The production controller passes nineteen groups, including fourteen new
constructed/reflected controls and the first owner sample; the second owner
sample passes separately. All **339 owner scans** match source. All **1,043
prior public primary lists** stay unchanged; computation/transfer median/p95/max
is **37/184/834 ms**, excluding engine time, startup and native UI. The immutable
worker is `liveTactics.worker-BUcz8DBd.js`, SHA-256
`30f58c5f02826c7a24c0fe3a35c1e70acea4d1ac0542476454b9df2f70828621`.

The forced-cold HTTP test again fails at twenty seconds with its first module
request pending. The child reports failure; the remaining owned test process
is stopped after verifying its command and parent. A separate warm-cache run
passes **129 cases**. Its first/max startup is **1,086/9,296 ms**: even warm
startup remains variable, and a passing repeat does not erase the cold fault.
No deadline is increased or error converted into an empty successful result.
Broader pawn/quiet-combination recall, independent primary-theme accuracy
measurement and load-sensitive native startup remain open.

Private authoritative source/engine receipts include
`adapter120-tests-final.json`, `adapter120-{private,rare}-final.json`,
`chesscom-{recall,disjoint}-adapter120-final.json`, and
`checking-exchange-verified-{probes,engine,controls,controls-engine}-20260916.json`.
Controller receipts are
`adapter120-worker-{public,capture,discovery,preparation,game,drawing,owner,disjoint}-final.json`
and `adapter120-dev-{cold,warm}-final.json`.
Earlier `checking-exchange-retreat-*` and `checking-exchange-controls-engine-*`
receipts preserve rejected witnesses rather than replacing them with successes.

Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
No owner data or phone runtime is changed by this source milestone.
