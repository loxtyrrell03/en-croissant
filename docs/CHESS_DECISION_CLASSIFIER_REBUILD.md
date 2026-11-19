# Chess decision classifier rebuild

## Objective and completion evidence

The owner requests a substantially better diagnostic system in En Croissant.
The rebuild must assess position character, move justification and mistake
mechanism separately. Tactical and positional support are independent dimensions.
Mixed and unresolved decisions must survive storage, filters and explanations.
An absence of a proved motif cannot establish positional play. Evaluation change,
material change, forcing notation and quiet notation are measurements only.

Completion requires all of the following evidence.

- A versioned reference set with reviewed positive, negative, mixed and uncertain
  labels. Include course exercises, owner classical games, independent games and
  adversarial controls. Preserve source/game groups across development and test.
- Baseline and each serious candidate evaluated on identical inputs, with
  tactical precision/recall, false positives/negatives, per-motif precision and
  recall, mixed performance, reviewer agreement, abstention, runtime and engine
  cost. Report uncertainty and denominators. Keep the final evaluation set
  untouched until architecture, thresholds and label protocol are fixed.
- Better held-out performance with materially improved meaningful-tactic recall
  and acceptable precision, including quiet/defensive/unsound combinations.
  Training-set gains and passing regression totals cannot establish this.
- Explicit mechanism, purpose and outcome for supported motifs. Cover forks,
  double attacks, pins, skewers, discoveries, deflection/decoy, defender removal,
  overloading, zwischenzug, interference, clearance, traps, mating nets,
  defensive resources and overlapping combinations.
- Positional evidence for structures, weak squares, outposts, activity,
  coordination, space, king safety, prophylaxis and imbalances. Test relevance
  with legal alternatives and opponent replies. Preserve the distinction
  between a feature observation and its importance to a particular decision.
- Actual app integration, saved-data compatibility, cancellation/cache ownership,
  understandable rendered results and end-to-end verification. Display each
  conclusion's engine support or heuristic status and its analysed horizon.
- Regression coverage, reproducible benchmark commands, remaining failures,
  accuracy/speed trade-offs and verified delivery.

## Existing implementation inspected

`mistakeNature.ts` delegates tactical cases to `mistakeReviewAdapter.ts` and its
large `causalTactics.ts` local proof library. A positional estimate requires
depth 14, a limited evaluation loss and two four-ply-or-longer continuations
containing no check, capture or promotion. The nature schema contains tactical,
positional and unknown, with allowed/missed attributes. It has no independent
positional evidence dimension or mixed value.

The live Tactics panel requests three engine variations, a bounded selection of
additional candidate roots, and uses an isolated worker for motif proofs. The
adapter combines the earlier theme detector with legal replay, bounded material
proofs, defensive comparisons, history handling, exact small endings and theme
ranking. Many apparent pattern matches are intentionally rejected. The finite
proof vocabulary/horizon leaves longer and quiet combinations unresolved.

Current local version is adapter 176 / live pipeline 183 / mistake nature 4.
The primary checkout already has an unrelated checking-ray deflection patch.
Baseline source hashes and that patch are saved privately. Preserve that work.
Existing pawn-structure extraction and Engine Plans are available for reuse.

## First measured baseline

The two downloaded Woodpecker courses were successfully read. There are 33 PGN
chapters and 2,128 distinct legal exercise roots in the combined candidate pool.
The sampler selected 120 roots by hash before engine inspection, with 30 per
course per partition. Entire chapters belong to development or validation.
Only the 60 development roots have been evaluated.

Stockfish 19 uses 60,000 and 600,000 nodes, MultiPV 3, one thread and 64 MiB hash.
A 300,000-node after-move search measures the third-choice alternative. This
third-choice experiment is a candidate-move audit rather than real human errors.
Use the last complete common-depth iteration, rejecting score bounds. A first
attempt that accepted final bound/partial lines was superseded and retained for
diagnosis. Node budgets for the corrected 60-root run total 57.6 million.

| Development group | Roots with live motif | Mistake tactical | Mistake positional | Mistake unknown |
|---|---:|---:|---:|---:|
| Tactical course, 30 roots | 10 | 8 | 0 | 22 |
| Positional course, 30 roots | 1 | 0 | 1 | 29 |

Course categories are weak labels. These are output counts, not precision or
recall. Combined live and mistake classification took a median 198 ms and a
maximum 922 ms per root, excluding engine work and UI. Engine alternatives with
negligible loss are included in these counts and must not be scored as mistakes.

## Experiments and current source

`decisionEvidence.ts` measures exact-position legal lines, candidate score gaps,
checks/captures/promotions, material trajectories, settled tails and draw/mate
endpoints. It rejects illegal tails, bound scores, wrong positions and incoherent
candidate comparisons. Material points and normalized engine evaluations remain
different quantities. Its consequence comparison measures material differences
and similar-material branches. Neither result assigns a chess-understanding
category.

An initial experiment mapping settled material differences directly to tactical
and similar-material branches to positional was rejected before integration.
Reviewed course examples demonstrate both failure directions. One combines a
bishop sacrifice and knight fork with a long-term rook-activity advantage.
Another exchange sacrifice secures a lasting bishop square. Both need mixed
support, and equal material alone would miss it.

`positionalEvidence.ts` reuses the pawn extractor and records isolated/doubled/
passed pawns, open/semi-open rook files, opposite-colour bishop pairs and
pawn-supported minor-piece squares without potential opposing pawn challengers.
These are board facts. A pinned supporting pawn or a possible piece exchange
can change their practical importance. Causal importance still requires the
engine/counterfactual layer. No production classifier or UI uses these
experimental measurements yet.

The private benchmark artifacts live in the active task workspace's
`classifier-rework` directory. They include source hashes, engine hashes,
complete search results, baseline outputs and three reviewed development
examples with separate tactical and positional evidence. Paid diagrams,
solutions and annotations must stay out of this repository and remote commits.

## Reproduction

Run `scripts/benchmarks/decision-evidence-sample.mjs` with the course directory,
a new private output filename and optional sample size. Sampling reads source
PGNs without altering them. Run `scripts/benchmarks/decision-evidence-engine.py`
with the sample JSON, Stockfish executable and private output directory. It needs
python-chess and defaults to development only. Engine SHA-256, exact FEN, node
budgets and options form the cache identity; incompatible cached results fail
explicitly. It retains the last completed common-depth MultiPV iteration without
score bounds. The receipt records the source-sample digest and cost settings.
The optional validation switch must remain unused until the candidate is frozen.
Set `DECISION_EVIDENCE_AUDIT` to the private artifact
directory and run `decisionEvidenceCourseAudit.test.ts` for production-baseline
measurements. The optional audit requires the recorded engine result directory
and refuses to overwrite an existing output. Normal tests use small constructed
positions in `decisionEvidence.test.ts` and `positionalEvidence.test.ts`.

## Evidence references

Stockfish evaluation is normalized against engine self-play. A score difference
does not identify its strategic or tactical cause. [Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html)

Lichess puzzle themes are useful candidates for reference review. Their tagging
rules have documented restrictions, including king forks and relative pins.
[Lichess tagging issue](https://github.com/lichess-org/lila/issues/17125)

## Outstanding work

Expand and adjudicate the reference data across all requested decision types and
motifs, including actual owner mistakes and fresh independent source games.
Build and compare engine-guided motif and positional-dependency candidates,
with mixed/uncertain evidence and adaptive cached search. Freeze the winning
candidate before opening validation. Integrate the full pipeline and UI,
verify real workflows and deliver only after the completion evidence above is
satisfied. The rebuild remains active.
