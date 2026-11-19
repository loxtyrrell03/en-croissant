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

## First measured baseline (superseded input protocol)

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

## Experimental candidate progression

The new code remains experimental and is not called by the production UI or
stored-review classifier. `tacticalSequenceEvidence.ts` builds legally replayed
mechanism witnesses, including the actual starting FEN and mechanism/payoff ply.
It currently covers used forks, deflections, defender removal, discoveries,
skewers, clearance, checking intermezzos, decoys into forks and short preparations
by a tracked piece. It suppresses duplicate fork/king-deflection descriptions.
Each witness is explicitly a continuation observation, not an all-defence proof.

`decisionAssessment.ts` separates position, individual move and actual mistake
assessments. Tactical and positional support are independent ordinal evidence
states, not probabilities. It retains applicable existing bounded certificates,
checks separate opponent-reply searches for score/position consistency, and can
report legal short mating continuations without inventing a named mating motif.
An allowed opponent fork can explain a mistake independently of a quiet better
move. Paired searches can compare actual played moves outside the global top
three. Later events retain their own boards and plies.

`positionalTransitions.ts` tracks new structural facts and their persistence.
The first candidate overlabelled incidental pawn changes during material wins.
The revised comparison requires both a specific persistent change and a worse
same-depth alternative with comparable settled material. Its interpretation is
still explicitly heuristic. This is too restrictive for many real strategic
decisions and does not yet meet the requested positional coverage.

The first reply-gated candidate also required the original PV's reply to remain
the new engine's first choice. Deeper analysis often changes that reply. The
revision inspects competitive separately searched replies and retains the
conditional line ownership. It never claims these are every legal defence.

A provisional 60-case development reference uses source annotations and legal
source/engine continuations. Null labels are unresolved, not negatives. Reviews
were made after development outputs, are not independently human-adjudicated,
and contain only three explicit tactical negatives. Source/main-engine move
disagreements stay unlabelled. They cannot support a general accuracy claim.

| Root move justification, provisional reference | Existing live classifier | Candidate v4 |
|---|---:|---:|
| Tactical positives detected / reviewed positives | 2 / 39 | 10 / 39 |
| False positives / reviewed tactical negatives | 0 / 3 | 0 / 3 |
| Positional positives detected / reviewed positives | 0 / 29 | 1 / 29 |
| Mixed positives detected / reviewed mixed cases | 0 / 11 | 1 / 11 |

This comparison concerns explanations of the first move, so later PV motifs do
not count as root detections. The earlier 10/30 live-label count includes later
events and answers a different question. The old live classifier has no
positional/mixed move output; its separate mistake classifier must be compared
on actual mistakes, not counted as a move classifier. Candidate v4 still misses
29 of 39 reviewed tactical positives and 10 of 11 mixed cases. Do not promote
these development gains as acceptance or held-out success. Per-motif accuracy
is unavailable until complete positive/negative motif references are reviewed.

Two further samples are frozen before candidate evaluation. A streamed CC0
Lichess sample has 96 distinct positions from 96 source games, with no game or
position overlap with the earlier fixture. Sixteen theme strata include quiet,
defensive and drawing tactics; source tags remain weak labels. Current exports
use both `/game/<id>` and `/<id>` URLs, which the sampler normalizes before
grouping. No raw public corpus is retained. A 48-position personal classical
sample has 24 games, one prior >=100 cp error and one <=20 cp decision per game,
across the previously verified classical time-control groups. Existing losses
only select strata. Fresh paired searches evaluate the actual recorded moves.
Development partitions are 48 and 24 positions respectively; their validation
partitions and the 60 course validation roots remain unopened.

Reply probing uses one million nodes, then four million if depth 16 or root
score consistency is missing, one thread and 64 MiB per process. Exact engine,
root-cache and search-setting identities govern cache reuse. The scripts retain
attempted/observed nodes and elapsed time. Material settlements, compulsory
draws and branch relevance can still prevent a confident classification.

The broader development audit found a second input-protocol issue: a new UCI
MultiPV frame can reorder roots at the same depth. A last-value-per-rank map can
then splice frames and duplicate a root. Engine protocol 2 accepts only complete
contiguous 1..N frames with distinct legal roots, matching depths, ordered scores
and no bounds. Its snapshots copy PV lists rather than sharing mutable updates.
Synthetic sequence regressions and a real Stockfish replay reproduce and fix the
affected course root. Earlier protocol-1 counts and candidate-v4 agreement above
are historical provisional measurements; protocol-2 reruns supersede them.

The protocol-2 rerun (candidate v6) reproduces the table's 10/39 tactical,
1/29 positional and 1/11 mixed development detections, versus 2/39, 0/29 and
0/11 for the old root-move output. The independent puzzle development sample
produces 32 tactical, 15 unclear and one invalid-input root assessment; these
are output counts, not accuracy against reviewed labels. The classical sample
produces three tactical and 21 unclear root assessments. Its actual-mistake
assessments retain all five existing tactical explanations, leave eight
measured errors unclear and produce no measured mistake for eleven choices.
The latter includes unavailable comparisons and must not be interpreted as
eleven confirmed correct moves. Pure assessment overhead medians were 20, 16
and 14 milliseconds in these runs, excluding legacy proof and engine search.
The extra reply searches remain the dominant cost. No validation partition was
opened for these iterations.

For the current experiments use `decision-evidence-public.py`,
`decision-evidence-classical.py`, `decision-evidence-engine.py`,
`decision-evidence-probes.py`, and `decision-evidence-review.mjs`. The opt-in
`decisionCandidateAudit.test.ts` accepts `DECISION_EVIDENCE_AUDIT`, a cohort
(`course`, `independent`, `classical`) in `DECISION_AUDIT_COHORT`, and a fresh
`DECISION_AUDIT_NAME`. It is deliberately development-only. Every audit saves
source hashes and refuses to overwrite an earlier result. Score reviewed
dimensions with `decision-evidence-score.py`; uncertainty is excluded from
denominators and abstentions on positives count as misses. Wilson intervals are
case-level descriptive intervals, not a correction for correlated source games.
The default evidence paths are `<cohort>-engine-v2` and `<cohort>-probes-v2`;
`DECISION_ENGINE_PROTOCOL=1` exists only for historical comparisons.

The research literature supports checking atomic chess claims separately from
their relevance to an explanation. The ACT-Eval paper reports that tool-backed
verification still misses errors; its linked data repository returned 404 in
this investigation, so no experiment here uses that unavailable reference set.
[ACT-Eval paper](https://arxiv.org/abs/2608.04240)
The public independent sample follows the documented premove convention and
CC0 terms. [Lichess database](https://database.lichess.org/#puzzles)

## Strategic trajectories and analysis-cost experiment

Candidate v7 adds root-linked strategic effects: a tracked pawn advance or lock,
piece reach outside opposing pawn attacks, restrictions of an opposing piece,
and an exchange by the root piece that removes the opposing bishop pair. Reach
is geometric and explicitly not legal/safe mobility; pins and other attackers
still matter. A captured root pawn cannot donate its identity to a replacement
pawn. These are board facts, not asserted evaluation contributions.

The architecture now admits a concrete persistent effect corroborated by a
separate best-reply search even when equally good strategic alternatives exist.
General space/activity interpretations require an early balanced-material
window while the feature persists. Specific structural transformations can be
the compensation for a sacrifice; requiring equal material would exclude those
mixed decisions. The window and heuristic status remain in the evidence. A
capture at the end of a longer PV cannot erase an earlier strategic window.
Mistake attribution still compares the actual played move separately.

The deeper-search experiment adaptively raises root nodes from 0.6 million to
2.4 million, then at most 9.6 million until depth 18. All 60 development roots
reached depths 18–23. Root searches requested 163.2 million nodes and took 184
aggregate engine seconds, with a median 3.34 seconds per position, excluding
reply probes and other searches. Increased depth alone made v8's development
agreement worse: tactical 9/39, positional 2/29, mixed 0/11. This is evidence
against treating deeper search alone as a classifier fix.

| Provisional course development agreement | Tactical / 39 | Positional / 29 | Mixed / 11 |
|---|---:|---:|---:|
| Existing root output, same deeper inputs | 2 | 0 | 0 |
| v7 root-linked effects, original budget | 10 | 3 | 1 |
| v8 separate reply persistence, original budget | 10 | 3 | 1 |
| v8, deeper root budget only | 9 | 2 | 0 |
| v9 explicit feature windows, deeper budget | 9 | 11 | 1 |
| v10 delayed defender removal / structural compensation | 11 | 13 | 2 |

All these runs have zero detections on just three reviewed tactical negatives;
there are no reviewed positional negatives. Precision remains inadequately
identified. The reference was source-assisted agent review after development,
not independent expert adjudication. Some source/root-engine move disagreements
and incomplete side variations remain. These numbers do not establish broad
accuracy or acceptance. Validation is still sealed.

The delayed defender-removal witness follows an unchanged target and attacker
through intervening moves and checks the removed piece's legal prior recapture
duty. This recovers a combination after an inserted check without inventing a
root fork: the fork retains its later ply and the removal retains the root ply.
One current mixed example is a knight fork whose eventual exchange removes the
bishop pair. Defensive prophylaxis, king safety and broader positional meaning
remain incompletely covered. Named motifs beyond the sequence vocabulary still
depend on the existing bounded proof library or remain unresolved.

Use `--minimum-depth 18 --maximum-root-nodes 9600000` for the cost experiment,
write to a fresh private cache, and set `DECISION_ENGINE_PROFILE=v2deep` for its
audit. The default profile stays `v2`; source/engine identities and actual
adaptive attempts are recorded. Never overwrite earlier evidence to rerun it.

## Bounded episodes and conditional capture resources

Candidate v12 separates a settled tactical episode from the end of a longer
principal variation. A later unrelated capture no longer erases an earlier
material outcome. The recorded episode starts at the original position, includes
settling replies after the witnessed payoff, and explicitly does not claim the
same material balance survives all later play. The witness must involve the root
move and the separate reply search must corroborate the root evaluation.

Candidate v13 additionally searches up to three legal captures of the moved
piece. This tests resources that the best defensive reply avoids. Ordinary
captures by a more valuable piece that can immediately be recaptured are
excluded. En passant uses the removed pawn's square. Each accepted resource
requires coherent legal evidence at depth 16 or higher, convergent root/best
reply evaluations, and either a legal mating continuation against the capturing
side or a used tactical mechanism with a settled net material gain. Recovering
the offered piece alone is not a gain. A score difference alone never supplies
a motif.

These branches remain conditional: they are not spliced into the main line,
labelled forced, or automatically used to diagnose the player's mistake. Their
motifs retain the refutation's own position and move numbers. Three development
recoveries include a knight offer that cannot be taken because of a mating
sequence, a bishop offer followed by a knight fork winning the queen, and a rook
offer whose acceptance leads to mate. These are engine-supported finite search
conclusions, not exhaustive proofs of all defences.

| Provisional course development agreement | Tactical / 39 | Positional / 29 | Mixed / 11 |
|---|---:|---:|---:|
| Existing root output, same deeper inputs | 2 | 0 | 0 |
| v10, deeper budget | 11 | 13 | 2 |
| v12, bounded tactical episodes | 14 | 13 | 2 |
| v13, separate capture counterfactuals | 17 | 13 | 2 |

There are still only three reviewed tactical negatives, with no detections on
them, and no positional negatives. Uncertain labels are excluded, not counted
as successful negatives. The five newly supported conditional resources include
three newly detected tactical positives; none establishes additional reviewed
mixed agreement because their positional reference labels are uncertain. This
is development evidence only. It does not meet the acceptance criterion for
held-out accuracy or establish high precision.

The 60-position experiment nominated 55 capture branches in 45 positions; 32
were already present in the reply frame and 23 required additional searches.
Those extra searches used 23,008,132 observed nodes and 29.08 aggregate engine
seconds (median 1.27 seconds per extra search). The nomination is bounded to
three branches per position. Some searches remain below the evidence depth
gate and are honestly unavailable. Main root and reply searches have their own
costs; total interactive latency has not yet been verified. Use
`decision-evidence-probes.py --capture-resources` and a fresh cache, then set
`DECISION_PROBE_PROFILE=v2deep-targeted` for the course audit while retaining
`DECISION_ENGINE_PROFILE=v2deep`.

The decision report now distinguishes an unrequested mistake analysis, the
best supplied choice, no meaningful measured loss, unavailable comparison and
an assessed error. A bad secondary PV cannot erase a valid principal line, but
its score is excluded and the candidate gap is unavailable. Castling aliases
are matched by their resulting board. Overloading is refined from a deflection
certificate only when the existing bounded exchange proof establishes the
defender's multiple duties and supplies separate legal acceptance/refusal
branches. Geometric resemblance alone cannot add that label.

The source-group audit resolved original player-pair identities for 112 of 120
course rows. It found two cross-partition player-pair collisions. Validation
excludes those overlaps plus six rows with unresolved game identity, retaining
52 course positions. Grouping every encounter of a pair across years is more
conservative than grouping by game, although spelling/initial differences can
still evade identity resolution. No validation classifier outputs were read to
make this mask. The independent and classical samples retain their source-game
grouping. Source annotations and paid material remain private.

Verification for this milestone: 82 focused frontend checks pass (one opt-in
audit is skipped without a private dataset), full TypeScript and scoped lint
pass, and 13 Python plus two source-group checks pass. Production integration,
rendered workflow checks and deployment remain outstanding.

## Remaining acceptance work

Expand and adjudicate the reference data across all requested decision types and
motifs, including actual owner mistakes and fresh independent source games.
Build and compare engine-guided motif and positional-dependency candidates,
with mixed/uncertain evidence and adaptive cached search. Freeze the winning
candidate before opening validation. Integrate the full pipeline and UI,
verify real workflows and deliver only after the completion evidence above is
satisfied. The rebuild remains active.
