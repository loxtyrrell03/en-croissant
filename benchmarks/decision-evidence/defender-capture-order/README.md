# Quiet moves that prepare a capture

The question is whether a quiet move enables a player to remove a
defender before collecting its original target. A legal recapture is a
reason to test both orders. The reference requires a substantial drop
in the wrong order and a searched line in which the actual defender
recaptures or takes the piece that would have removed it.

The discovery cases came from previously replayed positions. The
[frozen test](holdout.json) uses 144 other games from 28 standard
broadcast events. The sampler found 137 games with the recorded shape
in 3,671 eligible games. It retained one board per game, with 96 shape
challenges and 48 other midgame control boards. It excluded previous
event families, shared game prefixes and color-normalized boards from
the archival inputs named in the [manifest](holdout.manifest.json).
Selecting by the recorded game line makes the challenge deliberately
enriched. It cannot estimate the normal prevalence of this motif.

The [protocol](protocol.json) specifies the fixed budgets. Reference
work first compares both exact orders at the same legal board. A
positive must repeat the defender's action at a second budget.
Separate searches check whether the preparation, defending reply and
guard removal are competitive. Normal-budget detection takes only
Stockfish's visible continuations as candidate input. The geometry
arm sees the same candidate, and the comparison arm adds at most one
restricted search. Both arms can abstain or miss a candidate when the
engine chooses another continuation.

## Reproduce

From the repository root, use Python with `python-chess` and supply the
Stockfish executable matching the protocol. The benchmark reads the
frozen public histories directly. The manifest records PGN URLs and
hashes to reconstruct the split when the same source snapshots remain
available. The project's earlier working data is required only when
reconstructing the split, through the exclusions in the manifest.

```powershell
$bench = 'benchmarks/decision-evidence/defender-capture-order'
python "$bench/test_capture_order.py"
python "$bench/trials.py" app "$bench/holdout.json" $stockfish app.json
python "$bench/trials.py" ref "$bench/holdout.json" $stockfish reference.json
$env:DECISION_AUDIT_REVISION = '7e1524d5'
$env:INTERFERENCE_MODE = 'archive'
$env:INTERFERENCE_INPUT = 'app.json'
$env:INTERFERENCE_OUTPUT = 'baseline.json'
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/current-classifier-audit/replay.config.mjs
python "$bench/summary.py" app.json reference.json results.json --baseline baseline.json
```

An order judged harmless is a control for the exact capture pair. A
different pair on the same board needs a separate review. The ordinary
boards serve as runtime controls. The benchmark compares a specific
move justification. Position character, strategic effects and the
played mistake require separate evidence. This experiment does not
change the application.
