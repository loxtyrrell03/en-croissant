# Nominating replies outside Stockfish's cached lines

Decision Evidence v59 verifies quiet moves that prepare removing a
defender before a second capture. Its [cached selection experiment](../cached-capture-selection/README.md)
sometimes ran out of candidate replies. This experiment lets every
method look beyond the cached Stockfish lines.

The candidate generator starts with a competitive quiet move and
enumerates legal opponent responses. It can nominate an exact
question when the moved piece can take the original defender and
that defender could legally recapture if a second capture came
first. This geometry earns a search. It supplies no proof of the
superior order, of the opponent reply's practical relevance, or of
the move's purpose. The reference checks those conditions separately.

Every method can select one exact question per eligible board. The
comparison uses piece values, standardized logistic regression,
a small two-hidden-layer neural ensemble and a Stockfish shortlist
at the same 1.4M-node cap. Stockfish splits its budget between
a 150k-node preview of up to eight legal replies and the two
capture orders at the selected board. The learned methods see
the same early legal features as each other. They get no access to
the played continuation or source identity.

## Training and development

The two captured public classical sets in the
[training manifest](training-manifest.json) supplied 2,286 legal
questions. The fit uses 100 positive and 420 checked control labels
from 142 games and 40 events. There are 37 positives outside the
cached replies. The checked labels combine earlier deep exact
references with two new matched capture searches and a separate
reply comparison. The fit excludes unverified labels and also
excludes older uncompetitive-reply labels without a comparable
determinate score. The network scores prioritize search candidates
and have no calibrated probability interpretation.

The five event-group folds select 17 known positives for the
material rule, 17 for the logistic model and 15 for the network
when evaluating only the labelled unseen questions. Those
development numbers do not include the other legal alternatives
the same choices would compete with live. The final three networks
converged in 3,116, 1,343 and 743 iterations. One fit within a
development fold hit the 3,600-step limit. The selection totals were
identical in a shorter 1,200-step development run.
[Training run](training-summary.json)

## Independent sample

The [frozen sample](holdout.json) is 96 enriched capture-order
challenges and 48 ordinary controls selected from 3,704 eligible
games across 23 previously unused event families. Games, event
groups, and mirrored boards are excluded against the older data
as specified in the [manifest](holdout.manifest.json). The
[protocol](protocol.json) fixes the shared inputs, validation,
node budget and the minimum improvement to justify app integration.

## Reproduce

Run from the repository root with Stockfish 19 matching the
protocol, Python with python-chess, NumPy and the pinned
scikit-learn version in the training manifest. Recreate the two
shared older frame sets from the [capture-order](../defender-capture-order/README.md)
and [cached-capture](../cached-capture-selection/README.md) benchmarks.
The older exact and alternate reference captures supply the first
four label inputs to the training command. The archived model
weights are required only if skipping the fit.

```powershell
$bench = 'benchmarks/decision-evidence/unseen-legal-replies'
$base = 'benchmarks/decision-evidence/defender-capture-order'
python "$bench/test_legal_pool.py"
python "$bench/collect.py" $stockfish training.json --frames $firstCommon $secondCommon --labels $firstReference $firstAlternate $secondReference $secondAlternate
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
python "$bench/fit.py" training.json model.joblib training-summary.json
python "$base/trials.py" app "$bench/holdout.json" $stockfish roots.json
python "$base/common_replies.py" roots.json $stockfish frames.json
python "$bench/evaluate.py" frames.json model.joblib $stockfish attempts.json
python "$bench/review.py" questions frames.json attempts.json questions.json
python "$base/trials.py" ref questions.json $stockfish reference.json
python "$bench/review.py" report attempts.json reference.json results.json
```

The test measures one exact tactical mechanism across legal replies.
The ordinary cohort separately measures how often the more expansive
generator would request extra search during routine use.
