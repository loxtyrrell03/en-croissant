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

## Held-out results

The deeper reference verified 29 exact recorded comparisons from 15
events, found 20 harmless orders, and left 47 cases indeterminate.
The table scores only the 49 exact questions with definite status.

| Method | True positives | Misses | False positives | True negatives |
| --- | ---: | ---: | ---: | ---: |
| Legal pattern alone | 11 | 18 | 2 | 18 |
| Same pattern with a matched engine search | 11 | 18 | 0 | 20 |

The matched search recovered the same 11 reference positives across
nine events. The normal-budget selector did not nominate the exact
comparison for the other 18. The program also nominated different
comparisons from the recorded ones. Deeper searches confirmed two of
those, bringing the independently confirmed total to 13 of its 16
provisional calls. The three others remain indeterminate. Five of the
11 recorded confirmations, plus both additional confirmations, came
from boards the committed worker called unclear with common reply
probes. That comparison is against the committed worker with cached
frames. It does not run the desktop panel's other adaptive searches.

In the Bavarian Open, after `21.Bd6 Rfe8`, playing `22.Bxe7 Rxe7`
first allows `23.Bxd5`. The immediate `22.Bxd5` permits `22...Nxd5`.
The same-depth reference puts the difference at 667 centipawns of
engine evaluation. [Game broadcast](https://lichess.org/broadcast/29th-open-bavarian-chess-championship/round-1/atM541Zl/yuhxfBgN)

A Naples example explains why a second cheap search does not settle
the three open cases. After `26...Be6 27.Rc1`, both cheap searches show
the eventual capture on e3 after `27...Bxc4`. The deeper defence
`28.Kf2` changes the continuation and the original target is not
collected within the reference window. A separate Bangkok example has
the same problem. In the third case the initial move falls outside the
deep competitive band. [Naples broadcast](https://lichess.org/broadcast/1-festival-internazionale-di-scacchi-il-tesoro-di-san-gennaro-torneo-a/round-4/pNHP0yHN/rn52ut69)

There were 25 optional searches on the 96 challenges and none on the
48 ordinary controls. The optional searches took a median 1.41 seconds
in the parallel benchmark and used 30.6 million total nodes. A second
2.4-million-node comparison retained all 16 provisional calls,
including all three indeterminate ones. Its median wall time was
2.09 seconds including engine startup. It therefore adds cost without
resolving these cases. [Exact variations, outcomes and timings](results.json)

Keep the prototype offline. The comparison supplies a more precise
training target for a possible learned search selector. The benchmark
cases are reserved for evaluation. Earlier [same-board neural
ranking](../paired-choice-training/README.md) fetched one repeatable
witness at a budget where a simple legal material selector fetched two.
Any new fit should choose among independently labelled legal choices
and beat the simple selector at the same search budget on fresh event
groups. This experiment provides no new network accuracy result.

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
python "$bench/common_replies.py" app.json $stockfish common.json
$env:DECISION_AUDIT_REVISION = '7e1524d5'
$env:INTERFERENCE_MODE = 'archive'
$env:INTERFERENCE_INPUT = 'common.json'
$env:INTERFERENCE_OUTPUT = 'baseline.json'
node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/current-classifier-audit/replay.config.mjs
python "$bench/receipt.py" alternate-cases app.json extra-questions.json
python "$bench/trials.py" ref extra-questions.json $stockfish extra-reference.json
python "$bench/repeat.py" app.json $stockfish repeated.json
python "$bench/receipt.py" report app.json reference.json extra-reference.json repeated.json baseline.json results.json
python "$bench/oracle.py" reference.json common.json $stockfish coverage.json
```

An order judged harmless is a control for the exact capture pair. A
different pair on the same board needs a separate review. The ordinary
boards serve as runtime controls. The benchmark compares a specific
move justification. Position character, strategic effects and the
played mistake require separate evidence. This experiment does not
change the application.

## Candidate selection ceiling

As a diagnostic, the normal-budget verifier received the exact
question from the frozen recorded continuation, including the guard
removal and premature capture. It recovered 27 of the 29 deeper
positives and made no calls on the 20 harmless exact pairs. Twelve
indeterminate reference questions also passed the cheap verification.
These are verification results with the question supplied, not
end-to-end recall or estimates of the reliability of unsettled labels.

Of the 18 actual misses, eight already had the exact move order in
some shared search frame. Seven had the root and the opponent reply
but lacked the full move order. Three had the root without the reply.
This gives a concrete baseline to beat before comparing a network.
A selector should first use the available variations, then test
whether learning helps recover a useful candidate beyond them under
the same cost limit. The recorded question stays unavailable to a
candidate selector. [Coverage and verification replay](coverage.json)
