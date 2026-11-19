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

## Frozen evaluation protocol

`decision-evidence-freeze.mjs` saves exact classifier/dependency hashes, engine
identity, the predetermined exclusions and all 124 held-out identities (52
course, 48 independent and 24 classical). It also creates small filtered private
samples for engine analysis. No source corpus is copied. The configured policy
uses protocol 2, adaptive root depth 18 within 9.6 million nodes, separate reply
searches and bounded capture counterfactuals. Missing convergence/depth still
produces uncertainty rather than an invented classification.

Held-out audits require `DECISION_AUDIT_SPLIT=validation`,
`DECISION_FREEZE_PATH` and `DECISION_REFERENCE_PATH`. The saved reference must
cover every held-out identity, including explicit uncertainty. The runner checks
source hashes, original sample identity, exclusions, engine identity, root
budget/depth policy and reply-to-root cache binding before classification. Its
output records the freeze and reference hashes. Changing the model against
these results consumes this set as development data; it cannot become another
untouched result by renaming an output.

`decision-evidence-evaluate.py` reports move justification, position character
and mistake mechanism separately, plus explicitly reviewed motif positives and
negatives. Unknown motif labels are excluded. A conditional reply's fork is not
transferred into the original move's root-motif score. The old live root output
has no equivalent independent positional/mixed position dimension; its use as
a tactical position proxy is disclosed. Old mistake-nature output has no
comparable named-motif inventory, so that comparison is unavailable. Saved
reference bytes must match those recorded before held-out classification.
These safeguards pass two new freeze checks and 15 total Python checks, full
TypeScript and scoped lint. They do not themselves supply reference accuracy,
expert review or held-out results.

## Frozen candidate evaluation

The v13 freeze at `768f2006` covers 124 positions and 137 reviewed questions.
Reference notes for all cases were saved before classification, using legal
Stockfish continuations and, where available, the source exercises. These are
single-reviewer results. The independent collection is puzzle enriched and
classical errors were sampled alongside near-best moves. Uncertain labels
are excluded. Exact input, source, engine and reference hashes are retained
with the private reports.

| Reviewed question and dimension | Positives | Old TP / FP | v13 TP / FP |
|---|---:|---:|---:|
| Course move, tactical | 35 | 7 / 1 | 18 / 1 |
| Course move, positional | 24 | 0 / 0 | 4 / 3 |
| Course move, mixed | 9 | 0 / 0 | 0 / 2 |
| Independent puzzle move, tactical | 47 | 27 / 0 | 26 / 0 |
| Independent puzzle move, positional | 6 | 0 / 0 | 0 / 3 |
| Independent puzzle move, mixed | 5 | 0 / 0 | 0 / 3 |
| Classical mistake, tactical | 6 | 1 / 0 | 1 / 0 |
| Classical mistake, positional | 6 | 0 / 0 | 0 / 0 |
| Classical mistake, mixed | 1 | 0 / 0 | 0 / 0 |

On the reviewed course moves, tactical recall went from 20% to 51%, with
precision 7/8 and 18/19 respectively. There were nine reviewed tactical
negatives. The independent puzzle slice has no reviewed tactical negatives,
so it supplies recall evidence and cannot establish false positive control.
The small course position-character subset detected 1/4 tactical positives
and 3/13 positional positives, with no reviewed negatives. It offers limited
evidence about the independent position dimensions.

Root motif checks were selective. The candidate recovered the course's
reviewed discovered attack and skewer (1/1 each, baseline 0/1), missed two
clearances and one root deflection, and produced one fork false positive.
Independent fork recall improved from 4/7 to 5/7 with zero false positives
on 25 reviewed fork negatives. Independent discovered attacks stayed 2/2,
between-move insertions stayed 1/2, and three deflections, two back-rank-mate
mechanisms, one pin and one skewer remained missed. Per-motif precision with
few or no explicit negatives remains poorly measured.

Root search consumed 357.7 aggregate engine seconds, with cohort medians of
2.53 to 3.24 seconds per position. Separate replies consumed 452.6 seconds
over 290 searches and targeted captures added 15.4 seconds over 19 searches.
Root totals exclude the shallow comparison baseline and extra played-move
searches. Baseline classifier medians ranged from 56 to 139 milliseconds;
candidate analysis added another 30 to 39 milliseconds. These timings use
up to four one-thread engines in parallel and do not represent app latency.

The held-out audit runs in Vitest's Node environment. The browser-simulated
default test environment resolves the freeze module's import URL incorrectly.
Set `DECISION_AUDIT_SPLIT=validation`, `DECISION_ENGINE_PROFILE=v13heldout`,
the cohort, exact freeze and reference, and run the audit with
`vitest run --environment node`. Rerun the scorer on the matching saved
reference bytes. Once these results are used to improve the design, further
accuracy claims require fresh game groups.

## Tactics panel integration

The existing Tactics panel adds **Analyse position** and **Analyse last
move**. The latter searches the board before the move and explicitly compares
its actual result with the engine's choice. The result shows position
character, move justification and any measured mistake, with SAN lines in
expanded evidence. The current board stays in place. The tactical scan and
its existing motif previews remain available because the frozen candidate
has uneven results across cohorts and incomplete mixed and mistake coverage.

The deeper check is on demand and uses bounded one-thread searches. It checks
the exact board, legal line and search identity, preserving the available game
history and refusing losing claims across a known repetition boundary. Separate
reply and targeted capture searches only run within the session budget.
Aborting, changing the board or changing engines releases the owned search and
worker. The currently mounted board and engine reuse completed results for
the same move. Saved review data is independent of this exploratory report.

Browser verification at 320, 390 and 900 px exercised the rendered results,
cancel, evidence expansion, keyboard help and last-move analysis. A legal
Stockfish evidence fixture verified the actual worker and displayed the
conditional `axb5 Qxe2#` refutation. This verification used an isolated
search adapter for the browser. Native routing and engine lifetime are covered
by the existing transport and the new mocked lifecycle checks; installed
native-window delivery remains unverified.

## Matched early comparisons

The first held-out set identified a failure in the mistake path. The
classifier compared settled material at the ends of different-length
variations. A later unrelated exchange could erase the earlier cost. The
revised path compares the same number of plies after each choice. It requires
a separately corroborated reply, a witnessed opponent mechanism within the
early sequence or an immediately available capture whose local exchange
differs on the better board, and settled net material loss. Both lines are
available in expanded evidence; the resulting material difference is not a
claim about every defence.

In the development replay of the original 24 classical positions, calibration
moved tactical mistake recall from 1/6 to 2/6 with 0/14 false positives. One
recovered example has an opponent rook fork after a queen exchange. The fork
stays at its actual third ply after the played move. The strategic comparison
uses matched early windows too. It checks whether another move order reaches
the same tracked effect before the comparison point. This eliminated a false
attribution to an early pawn advance that both paths actually played.
It found 1/6 reviewed positional mistakes with 0/14 false positives. The
mixed classical mistake remained unresolved. These are development replays,
even though the source was originally held out.

Two additional candidates attempted to infer positional purpose from the
opponent's pawn recapture. Both introduced an additional positional false
positive on the courses and recovered no additional reviewed positive.
Duplicating the recapture in the reply search still observed the same
incidental structure. This feature was dropped. The resulting v17 preserved
the v13 course and independent dimensions reported above. A fresh 32-position
classical reserve was selected from 16 games excluded from both prior
partitions. Its test results are separate from the development replays.

The decision verifier now shares the development worker bundler used by the
tactical scan. It serves a self-contained worker with dependency invalidation,
avoiding per-job discovery of the classifier's modules in development.
The real development worker endpoint and the worker dependency recovery
tests pass. The focused frontend suite passes 120 checks with one opt-in
audit skipped, alongside 15 Python checks, full TypeScript and scoped lint.

The frozen v17 reserve consists of 32 positions from 16 classical games
disjoint from both v13 partitions. Single-reviewer labels were saved before
classification. Tactical mistake recall was 2/6, up from 1/6, with zero false
positives on 16 reviewed negatives. Positional recall was 1/8, up from 0/8,
with zero false positives on 15 reviewed negatives. No mixed mistake was
adjudicated positive, so mixed recall is unavailable. Tactical labels
remained uncertain on ten examples and positional labels on nine. Two
tactical predictions fell on uncertain labels and do not establish
precision. The new tactical detection identifies an allowed knight fork
that wins material. The new positional case identifies the difference
between retaining a central pawn advance and allowing the centre to open.
The baseline classifier median was 132 ms and the additional decision
assessment median was 38 ms, excluding the engine.

The full desktop frontend build succeeded and contains the separate decision
worker. The build is a local artifact and has not been installed or published.

## Mate and retained outpost evidence

The next candidate diagnoses a change from a finite evaluation to a verified
short mate, or a missed short mate replaced by a finite evaluation. A legal
mate in one is directly checkable. Other claims require agreement with the
separate reply search, exact board identity, matching mate distance, and a
legal continuation ending with the correct side checkmated. The report shows
the mating line with its move count instead of a pawn-loss value. Two
constructed back-rank cases exercised the real Stockfish search and
classification path, including Black allowing mate and White missing mate.
These are behavioural regressions with known mechanisms.

The actual-move comparison also considers a pawn-supported advanced minor
that the stronger line keeps and the played move abandons. Both lines are
checked at the same early horizon with comparable material. If the outpost
is reoccupied within the window, the alleged loss is withheld. This is a
strategic interpretation of measured board changes. On a development replay
of the 32 classical reserve positions, the feature recovered one additional
positional decision. Tactical recall remained 2/6 and positional recall
rose to 2/8 with no detections on the 15 reviewed positional negatives.
The original v17 held-out result above stays frozen. The replay cannot be
used as a new independent estimate.

## Tactical choices with lasting gains

The best reply can remove the piece creating a fork and avoid all material
loss. The candidate checks whether two material targets became newly
available to the moved piece, whether the best reply takes that piece, and
whether a separate worse reply actually permits one of the legal captures.
The threatened target must survive local exchange analysis. The material gain
must persist through the bounded aftermath. This reuses MultiPV reply
evidence from the existing search budget.

A quiet queen move can induce a queen exchange and a pawn recapture that
clears a rook file. Both searches must show the same structural consequence,
and a rook must actually use the opened file in at least one. A separate
feature follows an advanced passed pawn that persists in a middlegame with
several pieces. Short pawn races and promotions inside the evidence window
do not qualify as this positional feature.

On the v13 development replay, the paired fork and rook-file rule recovers
Qb4 as mixed. The best reply trades queens and opens the c-file; the separate
...Rd6 branch permits Qxa5. The d7 advance also becomes mixed by pairing the
concrete king attack with a lasting passer. v21 finds 19/35 tactical,
6/24 positional and 2/9 mixed course positives. False positives on the
reviewed labels remain 1, 3 and 2 respectively. The original v13 held-out
results remain separate. The 40-position course reserve is independently
sampled with unique identified player pairs, excluding all previous pairs
and exact roots. See `decision-evidence-course-reserve.mjs`.

The v21 reserve was scored after freezing the candidate and saving reference
notes for all 40 positions. The old root output recognised 3/24 tactical
choices and the candidate recognised 10/24. Both had zero false positives on
nine reviewed tactical negatives. Candidate positional agreement was 3/22
with three false positives on twelve reviewed negatives. The candidate
missed all six reviewed mixed positives and classified two of the 21
reviewed mixed negatives as mixed. The reserve therefore confirms an
improvement in course tactical coverage and does not establish useful mixed
recall. The two tactics recovered on the previous course replay were useful
regressions, but not evidence that the same improvement generalises.

Named root forks went from 0/2 to 2/2, with one candidate false positive on
ten reviewed fork negatives. Two deflections, one interference and one
intermediate move remained missed; other motifs have no reviewed positive in
this slice. Baseline classifier median was 126 ms and the additional
assessment median was 54 ms, excluding Stockfish. `decision-evidence-review.mjs`
can build a private validation packet from the frozen manifest, keeping
legal source variation prefixes distinct from the engine's lines.

Revealed desktop Mistake Review cards now offer **Analyse this mistake** on
the existing game information card. The check uses the saved board and
legal recorded move, including older cards with SAN but no UCI. It prefers
the card's configured local engine, then Stockfish. It appears only after
the answer is revealed and aborts its own work when the user changes cards
or hides the answer. This entry point shares the Tactics panel's report and
does not rewrite saved classifications or training history. The reveal,
legacy SAN, ownership and cancellation regression passes with the existing
review and tactics checks.

## Learned model comparison and overfitting

The v21 course replay recovered mixed examples that informed its design.
The subsequent frozen reserve found zero of six mixed positives. This is
direct evidence that the replay gains did not generalise to that sample.
The tactical gain held up, with a different precision and recall trade-off.

The current reviewed move examples supply 31 mixed positives across the
course and public puzzle sets. The classical mistake examples supply one
clear mixed positive and the independent puzzle slice has no tactical
negatives. Larger quantities of PGNs or Stockfish scores will not resolve
these specific label gaps by themselves.

`decision-evidence-model-pilot.py` compares an empirical prior, logistic
regression, a shallow boosted tree, and a one-hidden-layer neural model with
three fixed seeds. The two heads learn independent tactical and positional
labels. Inputs are 17 legal board and Stockfish continuation measurements,
without source categories or rule predictions. It trains on 112 older
course moves and scores on the 40 previously reviewed reserve moves.
The reserve was inspected before this model experiment. The reported
scores are development evidence and the 0.5 thresholds were fixed.

| Development pilot on 40 course moves | Tactical TP / FP | Positional TP / FP | Mixed TP / FP |
|---|---:|---:|---:|
| Current rule-based evidence | 10 / 0 | 3 / 3 | 0 / 2 |
| Logistic regression | 24 / 5 | 22 / 3 | 6 / 8 |
| Shallow boosted tree | 24 / 4 | 20 / 2 | 4 / 6 |
| Small neural network, all three seeds | 24 / 4 | 22 / 3 | 6 / 7 |

The denominators are 24 positives and 9 negatives for tactics, 22 and 12
for positional, and 6 and 21 for mixed. Unknown labels are excluded.
The closely matched logistic and neural results give little evidence the
extra model complexity is useful here. With engine scores only, the neural
pilot predicts tactical for all 33 reviewed tactical labels. On the 48
independent puzzle positions, the full neural pilot calls all 47 reviewed
tactical labels positive, a result also obtained by the constant prior.
The neural model predicts 3/6 positional with 8/41 false positives and 2/5
mixed with 8/41 false positives. It does not produce or verify motif evidence.

The next learned approach should rank plausible mechanisms or which replies
to search. Exact legal lines and counterfactual searches can then check the
ranked ideas before the app makes a diagnosis. A credible evaluation needs
ordinary tournament decisions, hard negatives and explicit mixed labels from
new game and source groups. Compare learned and rule-based candidates at a
matched false positive rate, with abstentions and evidence accuracy included.
Validate independently by question before using learned scores in the app.
No pilot model or private labels are shipped.

Relevant research supports this separation. Maia learns human move choice and
blunder likelihood from games, a different target from tactical and strategic
causes. ACT-Eval measures factual chess claims and concept coverage separately.
On structured features, benchmark studies have found strong tree baselines.
[Maia](https://arxiv.org/abs/2006.01855)
[ACT-Eval](https://arxiv.org/abs/2608.04240)
[NeurIPS tabular benchmark](https://papers.nips.cc/paper_files/paper/2022/hash/0378c7692da36807bdec87ab043cdadc-Abstract.html)

## Remaining acceptance work

Expand and adjudicate the reference data across all requested decision types and
motifs, including actual owner mistakes and fresh independent source games.
Build and compare engine-guided motif and positional-dependency candidates,
with mixed/uncertain evidence and adaptive cached search. Freeze the winning
candidate before opening validation. Integrate the full pipeline and UI,
verify real workflows and deliver only after the completion evidence above is
satisfied. The rebuild remains active.
## Tournament transfer and probe ranking (v22)

The course-trained model was frozen and checked on 41 distinct games from four
classical broadcasts. One decision per game was sampled before any engine
search or classifier score was available. The 33 ordinary moves were selected
by a stable hash from plies 26–119 with at least five legal moves. Eight separate
challenge moves were quiet decisions in the presence of an absolute pin. The
four events contributed 19, 12, 7 and 3 games. Earlier sampled board identities
were excluded at game level. Broadcast coverage and the deliberate challenge
stratum limit any estimate of the prevalence of tactics in tournament play.

The round exports were [4NCL Division 2 round 4](https://lichess.org/broadcast/4ncl-division-2-2025-2026/round-4/SEBFDJVY),
[Calvià Amateur Open round 4](https://lichess.org/broadcast/xxii-calvia-amateur-open/round-4/MoEmZRWG),
[Victorian Championship Reserves round 4](https://lichess.org/broadcast/2025-victorian-championship-reserves/round-4/GmSA3pnC)
and [South Carolina State Championship round 3](https://lichess.org/broadcast/2025-south-carolina-state-championship/round-3/EpvSOHnS).
The sampler verifies finished standard-chess PGNs and legal recorded moves.
Each tournament is wholly outside the course training data.

The reference contains 123 questions across the three decision scopes. One
engine-assisted reviewer inspected legal paired lines and replies blind to
classifier and model outputs, then saved the labels including uncertain ones.
Reviewed negatives are specific to the question and searched comparison.
Only four root motif checks were explicitly labelled for this sample.

| Decision and dimension | Reviewed positives / negatives | Legacy TP / FP | Verified rebuild TP / FP |
| --- | ---: | ---: | ---: |
| Move tactical | 16 / 16 | 6 / 0 | 8 / 0 |
| Move positional | 22 / 10 | 0 / 0 | 5 / 2 |
| Move mixed | 2 / 25 | 0 / 0 | 0 / 1 |
| Position tactical | 23 / 8 | 7 / 0 | 9 / 0 |
| Position positional | 26 / 8 | 0 / 0 | 9 / 2 |
| Position mixed | 9 / 16 | 0 / 0 | 0 / 1 |
| Mistake tactical | 3 / 31 | 0 / 0 | 0 / 0 |
| Mistake positional | 5 / 27 | 0 / 0 | 1 / 0 |

The old root preview supplies a tactical proxy for position character. It
offers no comparable independent positional or mixed move/position axes.
The legal verifier found the rook fork on e3 and emitted no pin label in two
explicitly reviewed pin negatives. It found the check and forcing follow-up
after Qe5+, but missed the knight fork on f6. It found the tactical purpose
of the quiet advance ...d3 only after the reply search, without identifying
its independent passed-pawn purpose. All three reviewed tactical mistake
mechanisms remained missed. Several separate motifs and late strategic effects
remain unscored or unrecognised.

**External transfer of the course-trained models.** All learned heads used the
same 112 course training moves and the fixed 0.5 decision threshold. No event
identity or reference label entered features. TP/FP below exclude uncertain
references.

| Method | Tactical TP / FP | Positional TP / FP | Mixed TP / FP | Tactical balanced accuracy |
| --- | ---: | ---: | ---: | ---: |
| Verified rebuild | 8 / 0 | 5 / 2 | 0 / 1 | 75% |
| Logistic | 13 / 8 | 21 / 7 | 1 / 13 | 66% |
| Small boosted tree | 14 / 3 | 20 / 7 | 1 / 8 | 84% |
| 16-unit neural net, all three seeds | 11 / 6 | 20 / 7 | 1 / 9 | 66% |

The neural net went from 24/24 tactical positives on the previously reviewed
course reserve to 11/16 on the tournament sample. Its tactical average
precision was 0.768 here, versus 0.872 for the boosted tree. On the descriptive
zero-false-positive ranking envelope, the neural net and logistic model each
ranked only three verified positives before their first reviewed negative.
The tree ranked two. The verifier made eight zero-false-positive detections.
This envelope uses evaluation labels to describe the ranking and does not
establish a threshold for future games.

**Ranking before verification.** The intervention replay used the same verifier
and root evidence throughout. Each ranker chose which boards received their
already cached extra reply branches. The root-only verifier found six tactical
and zero positional positives. Giving every board the extra searches raised
that to eight tactical and five positional positives. At ten boards, the
simple gap between the top two Stockfish root scores recovered both additional
tactical positives, using 26.0M extra nodes versus 28.0M for logistic or the
neural net and 32.0M for the tree. The fixed hash order recovered neither at
ten boards. This measures coverage at equal numbers of completed board probes
and reports their observed costs; it does not simulate an exact node cutoff or
an interactive search scheduler. There were only two additional tactical
positives to recover. The experiment does not establish that big score gaps
are a sufficient way to prioritise positional or mistake-mechanism evidence.

Root and paired search took 252.2 engine-seconds in aggregate. Optional replies
took 136.8 engine-seconds and targeted captures took 1.2 more, or 97.0M extra
nodes in total. The legacy classifier took a median 44.5ms per position. The
additional verifier and measurements took a median 25.8ms before the measured
engine cost. This is an offline benchmark with four concurrent one-thread
Stockfish processes.

**Reproduction.** The task's `classifier-rework/otb-transfer` directory has the
four round exports, preregistration, exact engine and source manifest,
classifier-blind review notes, labels and both reports. Rebuild the sample
with `decision-evidence-tournament.py`, using event IDs and ordinary/challenge
limits `4ncl-d2 14/5`, `calvia-amateur 9/3`,
`victoria-reserves 9/3` and `south-carolina 3/0`, in that order. Pass the
original course, independent and classical samples plus the v17 and v21
reserve samples as exclusions. Freeze the `tournament` cohort, then run
the v22 adaptive minimum-depth-18 search and reply probes. The source and
sample hashes are checked before auditing. Use the saved labels with
`decision-evidence-evaluate.py` and the original two course training sets with
`decision-evidence-model-pilot.py --tournament-transfer <registered-plan>`.
The SHA-256 of the original reference is
`1b8ceadbf830027f131d72cef73a75c26907fb502356828a96d22f7d43903ebb`.

The result gives no reason to introduce a neural runtime into En Croissant.
The tree is the stronger learned tactical baseline on this cohort, with a
substantial remaining precision versus recall trade-off. A future ranker
should be trained on which legal comparison adds a useful, verified
explanation, then tested within a fixed search cost on previously untouched
events. The selective-probe experiment here is evidence for that next
measurement, not for deploying a learned label. This v22 sample is open for
development after this report. No product classifier, runtime or profile was
changed by the experiment.

## Learning which reply to verify (v23)

The v22 tournament replay exposed a gap in material attribution. After
`...Rc3 Rxd1 Rxe3`, Black concedes the knight for a pawn. The better
`...Nxe3` line contains a different set of forcing trades, which makes its
total material balance a poor control for that local concession. The updated
verifier traces the actual victim to its square after the better move and
checks legal captures, including alternate attacking angles and en passant.
It requires the same immediate capture in two searches, a matching settled
cost and no stable recovery in either compared window. It reports the
played-line cost independently of the better line's aggregate material.
In the v22 development replay this recovers one tactical mistake, up from
0/3 to 1/3, with zero false positives on 31 reviewed negatives. Regression
coverage includes changed refutations and subsequent material recovery.

Four classical U2000 rounds supplied 90 decisions from 45 games. Each game
provided one recorded loss of at least 120 broadcast centipawns and one
within 20, with plies restricted to 26–99 and the pre-move broadcast score
within four pawns. Those broadcast scores select strata. Fresh paired
Stockfish searches and reviewed legal lines determine the actual evidence.
The development split is [Hull round 4](https://lichess.org/broadcast/hull-4ncl-congress-2025--u2000/round-4/BWuDgkr1)
and [Keith Escott round 4](https://lichess.org/broadcast/keith-escott-memorial-congress--u2000/round-4/XGwFKDk8/SR5UZPWO).
The untouched split covers 34 decisions from 17 games across
[Maia round 4](https://lichess.org/broadcast/maia-chess-festival-2025--u2000/round-4/vY5HhYTi/7Yzlw9Wo)
and [Reykjavík round 4](https://lichess.org/broadcast/u2000-mot-tr-2026/round-4/m7Qq4Olp).
Each entire source game and tournament belongs to one split. The review
used one engine-assisted reviewer blind to classifier and model results.
Two tactical and four positional reference labels remain uncertain.

| Played-move mistake | Reviewed positives / negatives | Legacy TP / FP | Rebuild with adaptive replies TP / FP |
| --- | ---: | ---: | ---: |
| Tactical | 11 / 21 | 3 / 0 | 4 / 0 |
| Positional | 5 / 25 | 0 / 0 | 2 / 0 |
| Mixed | 0 / 29 | 0 / 0 | 0 / 0 |

The additional tactical hit is `...Bf2`, which attacks g3 and e1 after
Kh1 and the queen trade. The two positional hits include the passed-pawn
timing after Nc4 and the space gained by answering `...Rhg7` with g4.
The sample supplies no reviewed mixed positives. Remaining misses include
king pressure with little early net material change, and a long checking
sequence after Rxb6 that culminates in a queen-for-rook exchange.

**Controlled reply ranking.** Each eligible board offered Stockfish's
three highest-ranked replies from a 300K-node unrestricted search. A forced
1M-node check for each candidate let every ranker face the same conditions.
At deployment inside this replay, a ranker can only select one check. The
common baseline is the rebuilt verifier with paired root lines and no
additional mistake certificate from another reply search. The experiment
measures newly established tactical mistake evidence, not agreement between
the ranker and Stockfish's ordering.

Three of 82 development queries actually added evidence to that baseline.
Training used two denser auxiliary targets: whether the deeper exact
reply agreed with the paired root score (38 examples) and whether it left
a settled material loss within 13 plies (22 examples). The 12-unit neural
network shares a hidden layer between those outcomes. Logistic and shallow
boosted-tree baselines learn the same outcomes in separate heads. Their
inputs are legal board and 300K-node search measurements. No deeper query
outcome, event identity or reviewed label is supplied as a feature.

| Ranking | Extra queries | Tactical hits / false alarms |
| --- | ---: | ---: |
| Common baseline, paired root only | 0 | 0 / 0 |
| Best 300K-node Stockfish reply | 17 | 1 / 0 |
| Reply in the paired PV or shallow material ranking | 17 each | 1 / 0 |
| Logistic, tree, three neural seeds and averaged neural scores | 17 each | 1 / 0 |
| All candidates in the shortlist | 51 | 1 / 0 |

Each single-query ranker spent about 17.0M extra nodes. All 51 checks spent
51.0M nodes and 68.1 engine-seconds in aggregate, with median 1.30 seconds
per check. The full adaptive benchmark spent an additional 73.1
engine-seconds on replies after the 230.4 engine-seconds of root, paired and
cheap-reply searches. The adaptive classifier had more useful evidence
available than the restricted one-query experiment. The low ceiling even
when checking every nominated reply is stronger evidence for improving the
proof and query types than for fitting a larger ranker to the same target.
No model enters the app. This audit measures finite-depth evidence and
transfer to these events only.

**Reproduction.** The saved task directory is
`classifier-rework/mistake-transfer`. Sample with
`decision-evidence-tournament.py --mistake-event EVENT PGN SPLIT GAME_LIMIT`
for Hull and Keith Escott (`development`, 14 games each), Maia
(`validation`, 13 games) and Reykjavík (`validation`, up to eight games;
four eligible). Reuse the five pre-v22 exclusion samples and the v22
tournament sample. Run the v23 standard depth-18 adaptive engine and reply
searches for each split. Run `decision-evidence-rank-probes.py` against
each matching root cache. Set `DECISION_AUDIT_RANK_REPLIES=1` for the
existing tournament audit and register the training audit before opening
the frozen held-out classifier results. The ranker reads the result and
the matching sealed reference. The reference SHA-256 is
`466657c5d4a442b8452f466dcba8ef1b81e7331ea5ea8bb4a73a99605ea0c869`.
Private artifacts provide the exact input identities and retained raw
engine evidence. Treat this cohort as development data after publication.

## Counterfactual attack entries and exploited pins (v24)

The mistake verifier can use a common attack in the paired root search
and an independent opponent search even if the net material difference is
small. It first verifies what changed about the entry. The better move
removes the attacker, forces an answer to check, or makes the same
checking move leave the king out of check. The engine frames must agree
on the reply's relevance. A verified quiet mate-in-one threat with an
observed legal defence or a captured pin must follow in both searched
continuations. The explanations cover the legal witness and the replies
within the finite search.

The pin extractor checks that a new absolute ray actually removes a legal
off-ray move of the defender. That ray must persist until the same pinner
takes the pinned piece, and the local capture proof must establish a gain
with counterplay checked. This preserves the pin's true ply. It avoids
credit for a geometric pin or for the incidental material balance elsewhere
in the line. It is available to move-level evidence as well as mistake
analysis.

The preceding 34-decision v23 benchmark is now a development set. Its
tactical mistake score rose from 4/11 to 7/11 with zero false positives on
21 negatives. The new examples were `...Re4 Nf5+ Kf8 Qf6` threatening
`Qh8#`, `Qxd7 ...Bg3` threatening `...Qxf2#`, and
`Rxb6 ...Qa1+` followed by `...Rf2` and the capture of the pinned queen.
Each better move changes the legal entry and each explanation includes
both lines. The tactical basis is a concrete mating threat or a locally
verified capture, independent of aggregate pawn balance.

The separate frozen v24 test had 48 decisions from 24 new games. Each game
provided one broadcast-evaluation loss and one near-best control. The
games came from [Olympiad Open I round 4](https://lichess.org/broadcast/45th-chess-olympiad-budapest-2024-open-i/round-4/6wJduA1I/nT9Ykpvl),
[Asian Amateur U2300 round 4](https://lichess.org/broadcast/asian-amateur-chess-championship-2025--open-u2300/round-4/EiOljS6R/z5AyEWaw)
and [World Amateur U2300 round 4](https://lichess.org/broadcast/fide-world-amateur-chess-championships-2026-u2300/round-4/xYn1a1FM/Yk2s81dE).
One reviewer labelled actual error mechanisms from legal paired and reply
lines before opening classifier results. Broadcast estimates were sampling
inputs only.

| Played-move mistake | Reviewed positives / negatives | Legacy TP / FP | Same-board v23 TP / FP | v24 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 11 / 26 | 1 / 0 | 3 / 0 | 3 / 0 |
| Positional | 12 / 27 | 0 / 0 | 0 / 0 | 0 / 0 |
| Mixed | 3 / 29 | 0 / 0 | 0 / 0 | 0 / 0 |

The new attack proof added zero detections on these boards. All methods
leave high recall and mixed classification unresolved. In five of the
eight tactical misses, the very same entry was still legal and relevant
to investigate after the better move. Two other misses reached the entry
but had no supported endpoint. The remaining miss failed the paired
root-depth gate. A subsequent development experiment forced the exact
same reply under each choice with one million nodes per query. The
opponent's score fell after the better move in all five cases, by roughly
3.5, 4.1, 4.5, 8.4 and 21.5 normalized evaluation pawns in this sample.
For example, `Nf4` attacks the rook after `Rxg6`, while after `Rd3`
the exact same `...Nf4` permits `Rdxf3`. This is evidence to compare
the continuation of a shared reply using its real legal alternatives.
The experiment was selected from missed cases after evaluation, and its
score differences are finite-depth measurements.

The audit also caught an en passant explanation referring to c3 for a
pawn physically captured on c4. The correction reuses the tracked victim
square. In that example Black gains a passed pawn on the c-file, supported
by its two rooks. The reviewed label is mixed on the basis of that passer
and the immediate tactical concession.

The v24 attack verifier uses existing engine searches. In the 48-position
audit those searches took 314.1 aggregate engine-seconds for root and
paired searches and 133.9 additional engine-seconds for replies. Median
extra classifier time was 26.5 ms, including replay and other measurements
in the same audit. The follow-up forced-query experiment is offline.

**Reproduction.** The task's `classifier-rework/forcing-transfer` directory
contains the private review, sample, manifest, exact searches and reports.
Use `decision-evidence-tournament.py --mistake-event EVENT PGN SPLIT GAME_LIMIT`
with `validation` and event limits 9/8/7 in the list order above. Exclude
earlier roots with the same seven sample paths used in the v24 receipt.
Run the standard depth-18 adaptive search and reply probe scripts, freeze
`v24-forcing-entry`, then audit and score the saved mistake references.
The preceding implementation comparator loads the three changed modules
from `94144454` and runs them against the same v24 engine inputs and legacy
certificates. The source manifest captures the shared checkout's exact
dependencies. Use this cohort for development following this report.

## Shared replies and advancing passed pawns (v25)

The same opponent move can be legal under both choices while serving a
different purpose. The verifier now nominates one shared reply when it
finds an attack on the moved piece or a material-winning capture available
after the better choice. The query reuses a complete matching reply
frame when available. Otherwise it runs the exact reply after the better
move with one million requested nodes, a three-second local deadline and
the existing 28-second session cap. The search retains the better move's
game history. A failed optional query still returns the main analysis.

The classifier requires a legal paired line, a corroborated played reply
and a material difference in the local exchange or a verified attack
that changes the piece's response. The exact shared reply must score
substantially less well after the better choice. The score checks
relevance, and the legal replies establish the mechanism. When the better move removes a piece
that could legally recapture in the played branch, the explanation names
the piece, its square and the recapture. The displayed paths show both
choices with the same reply.

The new positional evidence follows a pawn across its legal moves.
A pawn recapture can create an advanced passer for either side after the
original move. The same pawn must gain and retain that status in paired
and independently searched lines. Both contrasting lines must lack the
same advanced passer over the compared window. The independent searches
must preserve the ordering of the choices, although their gap can change.
The pawn-structure observation is a verified board fact. Its relevance
to the evaluation is a strategic interpretation.

On the v24 boards, now used for development, the tactical count rose
from 3/11 to 7/11. Positional rose from 0/12 to 2/12 and mixed from 0/3
to 2/3. Each dimension retained zero false positives. One example was
`Rd3 ...Nf4 Rdxf3`: `...Nf4` attacks the rook in both lines, and the
rook can capture a knight while escaping only from d3. After `Rxg6`,
the same `...Nf4` is met by `Rd6` in both searches. In a separate
example, `c4 ...bxc3` costs a pawn immediately and leaves a persistent
black passer on c3. The two findings support a mixed diagnosis.

**Fresh evaluation.** Thirty-six decisions from 18 distinct games came
from the [European Team Championship Open round 4](https://lichess.org/broadcast/european-team-chess-championship-2025-open/round-4/ZobBYM5c)
and the [4NCL Easter Congress U2000 round 5](https://lichess.org/broadcast/4ncl-easter-congress-2025-u2000/round-5/sE0VJ1IX).
The review used one engine-assisted reviewer, legal paired lines and
unrestricted replies. Labels were sealed before reading classifier or
restricted-query output. The preceding implementation was then run on
the same inputs using its assessment module from `729f962d`.

| Played-move mistake | Reviewed positives / negatives | Legacy TP / FP | Same-board v24 TP / FP | v25 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 9 / 17 | 1 / 0 | 1 / 0 | 2 / 0 |
| Positional | 8 / 18 | 0 / 0 | 0 / 0 | 1 / 0 |
| Mixed | 2 / 20 | 0 / 0 | 0 / 0 | 0 / 0 |

The new tactical hit compares the same knight reply on c6. `Bxd7`
removes the recapturing bishop so that `Bxc6` gains material. The new
positional hit follows an advanced d6 passer created by en passant.
The tactical component of that en passant mistake remains unresolved by
the classifier, so the output still misses the full mixed label. The
queen trap after `...Qf6 e5` also remains a miss. Stockfish's two
continuations move the queen to different retreat squares, which the
shared-reply verifier currently declines to conflate.

A development-only follow-up exercised the existing bounded trap prover at
the opponent's reply. After `...Qf6 e5` it established at least 5.7 local
material points across 29 defensive branches. The tool abstained after
the control `...Qh7 e5`. This suggests reusing reply-level trap proofs
when Stockfish takes different routes to the same tactical result. The
probe transcript is `queen-trap-development-v25.json`.

The application's nomination policy selected six boards in the 48-board
development replay, with one cached reply and five extra queries
(5.3 aggregate engine-seconds). It selected two additional searches on
the 36 fresh boards (2.7 aggregate engine-seconds). Median additional
classifier time in the full fresh audit was 38.5 ms before engine time.
The research cache precomputes broadly legal candidates, while these
figures count the queries the product policy selected. This validates
two additional individual detections on a small reserve.

**Reproduction.** Use the task's `classifier-rework/shared-reply-transfer`
directory, the two round exports and the eight earlier sample exclusions
recorded in its sample. The events each contribute nine games under
`--mistake-event`. Run the ordinary adaptive root and reply searches,
then use `decision-evidence-shared-reply.py` on both caches. Set
`DECISION_AUDIT_SHARED_REPLIES=1` in the freeze and audit steps. The audit
takes only queries nominated by the application and verifies their root,
reply and engine hashes before using them. References and results are
stored outside the checkout. Post-freeze safety and wording refinement
was checked on a replay of the same sealed cases. The broader classifier
goal remains open, including independent position character and mixed
recall beyond these mechanisms.

## Iteration 26 — piece traps with different retreats

Two searches can identify the same trap while choosing completely different
retreats. Requiring identical continuations missed `...Qf6 e5` when one
search showed `...Qf4 Bxf4` and the other showed `...Qg6 hxg6`.

Mistake analysis now checks a suspected trap with the existing bounded
material prover. The opponent's quiet move must create a profitable attack
on the piece that just moved. The independently searched continuation must
show that piece retreating and being taken by an answer inside the proof.
The same opponent reply after the better choice must lack the profitable
attack on that piece and score materially worse for the attacker in the
controlled Stockfish search. The explanation shows both lines and how
many legal defences passed the local material check. A regression removes
the bishop that covers f4 in the example and confirms that the surviving
retreat prevents a trap label even when the engine line shows a capture.

The earlier evaluation of 36 played decisions becomes development data for this
change. Tactical labels on those boards improve from 2/9 to 3/9, with
zero false positives among 17 reviewed negatives. The extra detection
is `...Qf6 e5`, with all 29 legal defensive branches checked. Positional
remains 1/8 and mixed remains 0/2, both with zero reviewed false positives.

**Fresh targeted evaluation.** A streamed sample from the [Lichess puzzle
database](https://database.lichess.org/#puzzles) contributes 20 pre-mistake
positions from 20 distinct games. Ten are tagged `trappedPiece` and ten
have a similar attack-and-capture shape. The reviewer assessed the legal
lines and ran Stockfish searches forcing each legal retreat before seeing
classifier outputs. Fifteen traps, four alternative mechanisms and one
uncertain attribution were recorded. All 20 are tactical mistakes. The
sample tests whether the system can distinguish traps from similar tactics.

| Question | Reviewed positives / negatives | Legacy TP / FP | Same-board v25 TP / FP | v26 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical mistake | 20 / 0 | 7 / 0 | 14 / 0 | 14 / 0 |
| Trapped-piece mechanism | 15 / 4 | Unavailable | 0 / 0 | 2 / 0 |

The two verified traps are `...Qxb2 Ra2` (31 defences) and
`Qxg7 ...Be5` (43 defences). Both already received a tactical diagnosis
from v25. The new evidence explains why the attacked queen has no safe
escape. In the negative examples `...Bb4` skewers a knight and rook and
`...c5` forks the queen and rook. The attacked piece can escape at the
cost of another piece, and the trap label is withheld. The measured
trap recall is 13% (2/15). The reviewed negative sample is too small to
estimate a reliable false-positive rate. Thirteen misses include pieces
left in place, retreats rejected by a mating threat, and alternatives
that lack a comparable shared reply. The tactical metric has no negatives
here, and positional and mixed questions were unreviewed.

Classifier time on this sample was about 44 ms median, excluding legacy
motif extraction and engine work. The existing nomination policy used 11
restricted queries (11M requested nodes, 10.8 aggregate engine-seconds).
The trap proof makes no new Stockfish request. A replay with the committed
motif engine in place of the concurrent worktree edits matched all 20
mistake reports. The 75 decision tests and 36 existing trap tests passed,
with one existing skipped test. TypeScript and scoped lint passed.
This is source-level verification.

**Reproduction.** Copy the two public manifests from
`benchmarks/decision-evidence/piece-trap-v26` to a new working directory
outside the checkout. The sample SHA-256 starts with `eab50232` and the
reference SHA-256 starts with `7cc5bd66`. Run the adaptive root and reply
benchmarks documented above with the `v26` cache profile and the same
Stockfish 19 engine. Use `decision-evidence-shared-reply.py` for the shared
reply cache. Freeze and audit under the `tournament` runner profile with
`DECISION_AUDIT_SHARED_REPLIES=1`, then run `decision-evidence-evaluate.py`
against the saved reference. The raw corpus was streamed and not saved.
The exact v25 comparator used both its assessment and shared-reply
modules from `1495c533` and the same engine inputs and query nominations.
Use a new sample for any future held-out result.

## Iteration 27 — traps without a shared reply or a retreat

The local prover could establish seven of 15 reviewed traps on the
earlier puzzle boards, including lines where the victim never moved.
Requiring the two choices to face the same opponent reply excluded some
of these cases. The narrower shared-reply proof remains available when
the exact counterfactual exists.

The second proof path requires paired searches and separate opponent
searches to agree that the played move loses ground. Both searches of the
played choice must find the same initial attack. The compared better
line must retain the same piece. The chosen legal defence and actual
capture must match the all-defence material proof, whether or not the
piece retreats. The result can name a verified trap even when an existing
mechanism already established that the mistake was tactical. This path
uses the searches already needed by the report.

**Held-out result.** The same public sampler drew another 20 positions
after excluding all 20 prior source games and their boards. The reviewer
checked the actual engine play and forced each legal retreat in a
separate search, applying the same material trap definition. A fork that
lets the attacked piece escape and a forced exchange of equal material
into a lost pawn ending are different mechanisms. Three cases remained
uncertain. The previous classifier was replayed with the same inputs.

| Question | Reviewed positives / negatives | Legacy TP / FP | Same-board v26 TP / FP | v27 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical mistake | 20 / 0 | 7 / 0 | 13 / 0 | 14 / 0 |
| Trapped-piece mechanism | 13 / 4 | Unavailable | 2 / 0 | 7 / 0 |

`Rh6 ...Kg7` traps the rook with eight legal defensive branches.
After `Rxg6+ Kxg6` the rook wins only a pawn, and `Rh7+` or `Rh8`
loses the full rook. The compared `Ra7` line retains the rook.
In a separate example, `...Be8 Ke7` traps the bishop even though the
engine continuation leaves it on e8 for capture. The tests also check
`Qc4 ...Na5 Nd5 ...Nxc4`, where the two searches on the played choice
pick different defences and the better move faces long castling.

On the earlier puzzle boards, now development data, trap detection
improved from 2/15 to 6/15 and tactical detection from 14/20 to 15/20.
No negative trap label changed. On the earlier 36 tournament decisions,
the tactical, positional and mixed counts stayed at 3/9, 1/8 and 0/2
with no new false positives. These results support the expanded proof
for this mechanism. They leave positional and mixed coverage unresolved.
Four reviewed negative cases are insufficient to estimate specificity
precisely. Exchanges, immediate mating threats and counterchecks can
fall outside the material proof, and the system still misses six of the
13 verified traps on the fresh sample.

Median classifier time stayed around 44 ms excluding engine work and
legacy motif extraction. The previous search policy nominated 11
shared replies, two available from cache and nine requiring a 1M-node
search (8.1 aggregate engine-seconds). The new proof path requested no
extra searches. 113 focused tests passed, one existing test was skipped,
and TypeScript and scoped lint passed. The replay with the committed
motif engine matched every fresh mistake report.

Public manifests are in `benchmarks/decision-evidence/piece-trap-v27`.
The sample and reference SHA-256 start with `d2a6892a` and `a871d5b2`.
Use the v26 procedure with the `v27` cache profile and compare with
the two corresponding modules at `7dbf0c70`. The source change has
been verified without replacing the installed app.

## Iteration 28 — position character from refuted alternatives

The previous position report inherited dimensions from the leading
moves. A quiet defence could have no tactical label of its own even
when the next plausible move lost material to a concrete tactic.
The position report now examines the runner-up and, when close to
the runner-up, the third candidate. A same-depth evaluation gap
nominates a check only when the published legal branches already
show a concrete early material consequence. A separate search on
the alternative's board must confirm the same tactical entry and
a compatible score. The local comparison rechecks the consequence.
An ordinary capture available after both moves cannot establish a
counterfactual. An evaluation gap alone is insufficient.

The workstation checks at most one extra reply for the position.
It reuses a reply search when that exact root was already searched,
and the optional query stays inside the existing time limit with the
original game history. The report stores the additional reply apart
from move and mistake evidence. In **Position character**, **Show
evidence** opens both compared SAN lines. The preferred move's own
classification is unaffected by an alternative's refutation.

**Held-out evaluation.** Two decisions per game were sampled from
18 previously unused games of the [London Chess Classic FIDE Open round
5](https://lichess.org/broadcast/2025-london-chess-classic-fide-open/round-5/3u7ggHST)
and [4NCL Division 2 round
5](https://lichess.org/broadcast/4ncl-division-2-2025-2026/round-5/mZIxt7nQ).
Within a game, one sampled decision had a large broadcast evaluation
loss and one was a control. The single engine-assisted reviewer
recorded tactical, positional and uncertain dimensions before the
audit and did not use the optional candidate-reply output for the
reference. The legacy tactical proxy uses a motif on the engine's
first choice. The legacy system has no independent positional axis
on this surface.

| Position character | Reviewed positives / negatives | Legacy TP / FP | Same-board v27 TP / FP | v28 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 20 / 9 | 3 / 0 | 4 / 1 | 6 / 1 |
| Positional | 22 / 9 | 0 / 0 | 6 / 4 | 6 / 4 |
| Mixed | 6 / 18 | 0 / 0 | 1 / 1 | 2 / 2 |

After `Qf1`, `...Nxf3+ Nxf3` wins the exchange. `Rg3` moves the
rook out of that capture. The new position diagnosis identifies the
tactical demand. The original positional reader also marks the rook's
semi-open file, which creates a false mixed result on the saved label.
In a reviewed mixed position, `...Kc7` gives White `Nf7 Qf6 Nxh8`,
a fork distinct from the durable pressure of `...Nd4` with the c3
passer. The v27 replay matched the move and mistake reports exactly,
so the measured changes apply only to position character.

Three additional searches used 3M requested nodes and 2.8 aggregate
engine-seconds. Two corroborated the projected tactic. Median candidate
classifier time was 35 ms excluding legacy motif extraction and engine
work. The targeted tests cover sound and refuted alternatives, a reply
from another search, score disagreement, optional search failure,
and a far inferior move. The 116 focused TS checks passed, with one
existing skip. Twenty-two sampler and protocol checks, types and scoped
lint passed. An isolated browser build exercised the production panel
and decision worker at 320, 390 and 900 px with recorded Stockfish
search input. It verified position analysis, keyboard expansion and
both SAN lines. The native query route was tested with mocked engine
transport. These checks are for the source and isolated build.

**Reproduction.** Copy the two public manifests under
`benchmarks/decision-evidence/position-character-v28` into an exterior
working directory. Use the adaptive root and reply procedure above,
with `--position-choices` when generating reply probes in
`tournament-probes-v28-position`. Build the matching shared-reply cache
in `tournament-shared-v28-position` using those probes. Freeze and audit
with `DECISION_AUDIT_POSITION_CHOICES=1`,
`DECISION_AUDIT_SHARED_REPLIES=1`, `DECISION_ENGINE_PROFILE=v28`, and
`DECISION_PROBE_PROFILE=v28-position`. The same-board comparator
uses the assessment module from `fb55be9c`. Use another disjoint set
for any held-out claim based on changes derived from these results.

## Iteration 29 — strategic plans across viable moves

Position character now checks whether the engine's leading legal
choices return to the same strategic objective. Two distinct root
moves with similar evaluations must both act on the same passed pawn,
occupy the same pawn-supported outpost, or penetrate on the same rook
file. The analysis follows the original pawn or piece through the
continuation. It compares matched, settled material windows within
the first twelve plies. The positional interpretation remains a
heuristic tied to the displayed board facts. **Show evidence** shows
the two SAN lines.

Inherited position evidence also requires more than its visible
feature. A newly occupied file needs a quiet rook entry to the fifth
rank or beyond. Bishop-pair removal requires a settled material-
balanced branch. Incidental reach after a capture and a newly passed
pawn still in the rear ranks provide too little evidence on their
own. A late preparation witness alone also provides too little
evidence of immediate tactical demand at position level. The
decision report continues to use the original evidence when it
examines what an individual move achieves.

**Development replay.** The 36 v28 decisions are now development
data. A first version requiring simultaneous persistent activity
found 6/22 positional cases with zero false positives on nine reviewed
negatives. Adding continued control of a blockading square and balanced
rook exchanges yielded 7/22 with zero false positives, versus 6/22
and four false positives for v28. Tactical detection stayed at 6/20
and the false call was removed. The mixed count went from 2/6 to 1/6
while false mixed calls went from two to zero. In the `Rg3` case,
the new g-file square does not establish positional activity. The
verified exchange threat after `Qf1` supplies the tactical explanation.
In a different position, `...Be6` and `...Bg6` both allow `Rc8`
and the same rook exchange on c7. The report identifies that file
contest even though the penetrating rook is eventually exchanged.

**Fresh evaluation.** Thirty-two played decisions from 16 previously
unused games came from the [European Individual Chess Championship
2022 round 6](https://lichess.org/broadcast/european-individual-chess-championship/round-6/7j8EXyxe)
and the [2025 British Major Open round
7](https://lichess.org/broadcast/2025-british-chess-championships--major-open/round-7/24d5UjWS).
The game-grouped loss/control stratification and review procedure
match v28. The single reviewer saved the labels without seeing
classifier or optional position-reply output. The v28 comparator used
the same engine data and optional queries.

| Position character | Reviewed positives / negatives | Legacy TP / FP | Same-board v28 TP / FP | v29 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 22 / 5 | 4 / 0 | 8 / 0 | 8 / 0 |
| Positional | 18 / 9 | 0 / 0 | 7 / 3 | 7 / 3 |
| Mixed | 8 / 14 | 0 / 0 | 2 / 1 | 1 / 1 |

The shared-plan evidence adds three correct positional calls. After
`Kd2`, `Be3` establishes a blockade of Black's e4 passer. After
`a3`, `Re3` performs the same job. Another case shows Black using
the a-file with `...Ra3` in both move orders. The stricter file
qualification discards three genuinely strategic examples. In one,
`...Rfc8` uses the file to exchange on c1 rather than staying on an
advanced square. The aggregate result is a precision gain in
development and a change in which fresh cases are detected, with a
mixed-recall loss. Remaining false positional calls include a pawn
push that solely stops a direct attack, a checking outpost serving
an immediate combination, and a pawn advance with an immediate
promotion threat. These cases show why even a persistent board fact
can provide insufficient evidence of a separate positional purpose.

The strategic comparison adds no engine requests. The existing
position-refutation nomination on one fresh board reused a reply
already searched for the played move. Median additional classifier
time was 27 ms excluding the engine and legacy extraction. The
frozen scores were reproduced with the committed tactical engine
and a wording refinement to the plan description. 119 focused tests
passed, with one existing skip, plus TypeScript and scoped lint.
An isolated browser build verified position analysis, both plans and
keyboard expansion at 320, 390 and 900 px using recorded searches.

Copy the manifests from `benchmarks/decision-evidence/strategic-plans-v29`
to an exterior working directory. Follow the v28 engine and audit
procedure with the `v29` cache profile for all caches and with
`--position-choices` for the reply generation. The predecessor
assessment is at `1c660d43`. Use new game groups for any held-out
claims from work informed by the failure cases above.

## Iteration 30 — follow-through on a file or square

The previous rank gate lost some sound positional explanations.
`...Rfc8` prepares `...Rxc1+ Nxc1` while the rook waits on its own
back rank. The position report now follows the original rook from
the appearance of the file feature. It accepts a later same-file
rook exchange when both rooks are captured and material returns
to its pre-exchange balance. Either side can initiate the exchange.
The file itself must persist in the separate reply search before
the exchange is counted as position evidence. The report names the
actual two moves.

The pawn-space check now asks what the advance accomplished. The
pawn can advance again, sustain control after displacing a piece,
support a piece which actually uses a new square, or cover a square
an opposing minor piece uses in the matched alternative. For
example, `...g5` covers f4, while after `...gxf5` the other line
uses `Nf4`. Checking outposts need a settled material window. A
push to the seventh rank with an immediate promotion threat needs
additional evidence before it supports a separate positional label.

Two development cohorts exposed the trade-offs. The first version
of the broader rook trace reintroduced a positional false call on
a defensive rook exchange. The independent-file requirement removed
it. The first pawn-space qualification also lost two reviewed
space advantages. Adding actual displacement and opposing square
use restored them.

| Development position cohort | Positional positives / negatives | v29 TP / FP | v30 TP / FP |
| --- | ---: | ---: | ---: |
| London and 4NCL, 36 boards | 22 / 9 | 7 / 0 | 7 / 0 |
| European and British, 32 boards | 18 / 9 | 7 / 3 | 8 / 0 |

The second replay also removed its one false mixed call, retaining
one correct mixed call out of eight. One correctly labelled older
mixed position lost its positional evidence. Its old explanation
relied on a checking outpost, while the reviewed strategic value
came from the doubled rooks and pawn structure. That distinction
is still a coverage gap.

**Held-out evaluation.** The general sample contained 28 positions
from 14 games across the [2025 FIDE Grand Swiss Open round
5](https://lichess.org/broadcast/fide-grand-swiss-2025-open/round-5/ADzdjVmn)
and [2026 British Major Open round
6](https://lichess.org/broadcast/2026-british-chess-championships-major-open/round-6/vCGDNHBe).
A separate challenge sample used 12 other games from those rounds.
It retrieved six quiet entries from the first four ranks with a
later equal exchange and six similar entries without a qualifying
exchange or advance.
The retrieval strata came from the actual game, while the reviewer
labelled the position from the legal engine lines and ordinary
probes. References were recorded before candidate or optional
position-reply output was examined.

| Held-out question | Reviewed positives / negatives | Legacy TP / FP | Same-board v29 TP / FP | v30 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| General tactical | 21 / 3 | 3 / 0 | 6 / 0 | 6 / 0 |
| General positional | 18 / 5 | 0 / 0 | 2 / 1 | 2 / 1 |
| General mixed | 11 / 8 | 0 / 0 | 0 / 0 | 0 / 0 |
| File challenge positional | 10 / 1 | 0 / 0 | 3 / 0 | 3 / 0 |

Only two of six recorded rook entries in the exchange stratum were
the engine's first choice. Even when they were, the engine principal
variation could select a different follow-up. The focused sample
still supplies hard cases, but it demonstrates limited transfer
for the new trace. The two fresh comparisons provide no aggregate
accuracy gain over v29. They also show that broader positional and
mixed recall remain low.

The file and pawn checks use existing engine lines. The general
audit took about 42 ms median for the candidate logic, excluding
engine work and legacy extraction. The predecessor replays used
the same inputs and matched the move and mistake reports. Source
regressions cover each side initiating a rook exchange, an unrelated
replacement rook, pawn restriction visible in an alternative, and
passive file occupation. There were 124 focused tests passed and
one existing skip. TypeScript and scoped lint passed. The committed
tactical core reproduced every position report for both cohorts.
The rook-exchange explanation was rendered
with the production panel and worker at 320, 390 and 900 px using
recorded Stockfish input.

**Reproduction.** The general and challenge manifests are under
`benchmarks/decision-evidence/file-use-v30`. For each cohort use the
v29 cache procedure with profile `v30`. The file challenge sampler
is `scripts/benchmarks/decision-evidence-file-sample.py`. The v29
comparator uses the assessment and position-plan modules at
`5c0208b7`. Keep the challenge separate when reporting results.

## Iteration 31 — pawn shelter in a tactical decision

Two captures of the same piece can require different kinds of reasoning.
After `Nxf3` and `gxf3` in the development position, White takes the same
bishop. The tactical report explains the exchanges around c1. The new
positional comparison also shows that `gxf3` opens the g-file in front of
the king. Black obtains `...Qg5+` down that file. In the `Nxf3` line the
pawn remains on g2, between g5 and the king, through the corresponding ply.

The position report compares legal same-depth candidates. Two captures
of the same target qualify for comparison even when their scores differ
substantially. For a pawn-shelter diagnosis the original pawn must be
present in the control line at every compared ply. In the exposed line
the file must remain clear of defending pawns and the opposing queen
or rook must actually use that file to check the king. The mistake
report also requires the effect in a separate reply search on both moves.
The pawn cover and legal check are board facts. The interpretation that
they constitute a positional consideration is labelled heuristic.

On the reviewed 28-board v30 development replay, position recall rose
from 2/18 to 3/18 positional and 0/11 to 1/11 mixed, with one positional
false positive in both versions and no mixed false positives. The same
board gained an explanation in the mistake report. That board informed
the implementation and provides regression evidence.

**Held-out evaluation.** The 28-board general sample pairs losses and
controls across 14 games from the
[2025 British Championship, round 6](https://lichess.org/broadcast/2025-british-chess-championships-championship/round-6/93ur7ddm)
and [2025 European Club Cup, round 4](https://lichess.org/broadcast/european-chess-club-cup-2025--open-matches-1-16/round-4/IBcpk6tK).
The separate 12-board challenge takes six games in which a king-file
pawn captured and six in which a piece captured, with both capture
types legally available on each board. No challenge game appears in
the general sample. A single engine-assisted reviewer assigned both
axes using the leading legal variations and ordinary reply probes
before seeing the classifier output. Uncertain axes are excluded.

| Held-out question | Reviewed positives / negatives | Legacy TP / FP | v30 TP / FP | v31 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| General tactical | 22 / 0 | 2 / 0 | 4 / 0 | 4 / 0 |
| General positional | 22 / 4 | 0 / 0 | 7 / 0 | 7 / 0 |
| General mixed | 16 / 4 | 0 / 0 | 1 / 0 | 1 / 0 |
| Shelter challenge tactical | 7 / 1 | 4 / 0 | 4 / 0 | 4 / 0 |
| Shelter challenge positional | 10 / 1 | 0 / 0 | 1 / 0 | 1 / 0 |
| Shelter challenge mixed | 5 / 2 | 0 / 0 | 0 / 0 | 0 / 0 |

The v30 and v31 position, move and mistake reports matched on all 40
boards apart from the version field. The general cohort has no reviewed
tactical negatives, so it cannot estimate the tactical false-positive
rate. The challenge exposes two limitations. A shelter-pawn capture
can change the structure even when the opponent attacks on another
file, and some meaningful alternatives sit outside the three engine
candidates. For example, after `...gxf6` in challenge board 10 the g-file
opens and the f-pawns double, but the opposing response takes central
space with `e4`. The new explanation abstains in that case. This
iteration provides one reproduced development improvement and no
held-out accuracy gain over v30. Mixed recall remains low.

The change uses the existing engine search budget. On the exact
committed tactical core, median classifier time for v30 and v31 was
about 27 and 25 ms on general and 20 and 22 ms on challenge,
excluding engine search and legacy extraction. The focused suite
passed 127 tests with one existing skip. Source type and lint checks
passed. The production worker and panel displayed the position and
mistake explanations at 320, 390 and 900 pixels in an isolated browser
with replayed Stockfish evidence.

**Reproduction.** The review and sample manifests are under
`benchmarks/decision-evidence/king-shelter-v31`. Use the v29 root and
probe cache procedure with profile `v31` and candidate
`v31-king-shelter`. Retrieve the challenge with
`scripts/benchmarks/decision-evidence-shelter-sample.py` and exclude the
general sample and prior games. The v30 comparator uses the assessment
module at `5d7a2de6`; both comparisons use that revision's tactical
core. The earlier course-trained model and reply-selection experiments
still provide the evidence for leaving neural inference out of the
interactive classifier.

## Iteration 32 — search breadth and human-move nomination

The existing position reports can miss an important choice in two ways.
Stockfish may leave it out of the candidate list, or the classifier may
fail to explain the lines it already has. This experiment changes
search inputs while keeping the v31 verifier fixed.

### Three versus eight Stockfish candidates

The four general development cohorts from v28–v31 contain 124 reviewed
positions. The two 12-position challenge cohorts are scored separately.
For each board the original three-line search was compared with eight
lines at the same final requested node budget. Both widths were also
searched with four times that budget, capped at 9.6M nodes. Analysing
only the first three entries from the same eight-line frame isolates
the contribution of ranks four through eight from changes to the
search itself.

Each setting used independently searched replies to its first choice
and any alternative nominated by the existing position-refutation
rule. Replies for identical positions were shared in the bench. This
replay uses the same ordinary reply policy in every arm. Targeted
capture probes and game-history effects were excluded. A rejected
principal variation counts as an abstention. The experiment evaluates
previously reviewed positions and does not provide a new holdout.

| General development search | Median depth | Root nodes | Tactical TP / FP | Positional TP / FP | Mixed TP / FP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original three | 20 | 285.0M | 23 / 0 | 24 / 1 | 4 / 0 |
| Eight, score first three | 16 | 285.0M | 23 / 0 | 17 / 0 | 4 / 0 |
| Eight, score all | 16 | 285.0M | 23 / 0 | 19 / 0 | 4 / 0 |
| Deeper three | 25 | 1,111.2M | 23 / 1 | 17 / 1 | 3 / 0 |
| Deeper eight, score first three | 21 | 1,111.2M | 25 / 1 | 14 / 2 | 3 / 0 |
| Deeper eight, score all | 21 | 1,111.2M | 25 / 1 | 17 / 3 | 3 / 0 |

There were 85 reviewed tactical positives and 17 negatives, 80
positional positives and 27 negatives, and 41 mixed positives and 44
negatives. Unknown labels are excluded per axis. Allowing the live
certificate scanner to consider the first two supplemental choices
from the deeper eight-line frame produced the same counts.

With the original budget, 57 boards gained at least one choice within
100 centipawns of the best at ranks four through eight. This recovered
two positional true positives relative to scoring the first three
entries of that same frame. Yet positional recall fell from 24 to 19
relative to the original search. On nine of the ten boards that lost
a previously supported positional label at the same budget, Stockfish
kept the first move. It changed the continuation or the alternatives
that supported the explanation. For instance, the first move in the
4NCL position `2aea9ec930c2e3da-55` remained `...Be6`, while the wider
frame lost the shared rook exchange on the c-file that supported
the original explanation. At the higher budget the four-through-eight
choices recovered three positional true positives and added one
false positive relative to its own first three. The two focused
challenge cohorts also gave mixed results. A wider default search
has insufficient evidence of benefit.

### Can a neural model choose a better extra move?

Maia-3 5M predicted likely human moves at its Elo 1900 setting.
The comparison tested one move outside the original three per board.
Maia supplied the highest such move from its ranking. The Stockfish
comparison supplied the first such move from the equal-budget
eight-line frame. Selection used the board and engine candidates
without access to the recorded move or review labels. Maia's
evaluation fields were discarded. [Maia-3 official implementation](https://github.com/CSSLab/maia3)

The same Stockfish verification followed each nomination. A 1.2M-node
paired search compared the suggestion with the original first move.
An extra 1M-node opponent search was requested for a confirmed first
choice and a drop of at least 100 centipawns or a newly allowed mate.
Only a concrete tactical episode or mating consequence from the
existing mistake verifier counted as evidence. The initial scoring
experiment provisionally adds this evidence to the position's tactical
axis. Positional evidence still comes from the original report.

| General development route | Extra moves tested | Recorded moves retrieved outside the top three | Refutations verified | Tactical TP / FP | Mixed TP / FP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original analysis | 0 | 0 of 44 | 0 | 23 / 0 | 4 / 0 |
| Extra Stockfish choice | 124 | 5 of 44 | 8 | 28 / 1 | 4 / 0 |
| Extra Maia choice | 124 | 15 of 44 | 20 | 34 / 2 | 6 / 1 |
| Maia restricted to its first two ranks | 80 | 13 of 44 | 9 | 29 / 0 | 4 / 0 |

The first two ranks were selected after inspecting development
errors. For example, Maia's third-ranked `...Nh5` in the European
Individual position `125107747783814e-43` allowed a later removal
of the defender. The independently verified variation was legal,
but the position reference emphasized the pawn structure and
knight plans arising from the leading choices. This is an
attribution problem as well as a move-selection problem. At the
top-two cutoff, one real gain is the London position
`6173b5a23b7fd326-65`, where Maia nominated the recorded `...Rxd4`
and Stockfish verified `Nxd4` winning the rook. It also found
`...Ng3+` in the Grand Swiss position `460511aae00015dd-63`,
where `fxg3` changes the exchanges relative to `...Qg5`.

On those 124 boards the unrestricted Maia route requested 92
reply searches, the top-two replay would request 52, and the
Stockfish route requested 72. Corresponding budgets after move
nomination were 240.8M, 148.0M and 220.8M nodes, excluding the
original analysis and the extra wide frame needed for the
Stockfish nomination. Maia's median warm request was about 75 ms
on one CPU thread in this experiment. The two challenge sets are
available in the same scoring report and do not enter the table.

Neural move nomination is promising enough to test prospectively.
The restricted rule improves tactical recall on development, with
unchanged aggregate mixed recall. The evaluation is too small to
establish high precision on fresh games, and the unrestricted
experiment exposes the risk of treating an avoidable error as a
feature of the whole position. The app still uses the v31 search.

### Reproduction

Build a root cache for the six checked-in v28–v31 manifests with the
same Stockfish 19 revision and adaptive root profile documented above.
Run `decision-evidence-breadth.py` with one `--cohort NAME SAMPLE ROOT_CACHE`
argument per cohort. In a clean checkout run
`decisionBreadthAudit.test.ts` with `DECISION_BREADTH_AUDIT` set to the
output directory and `DECISION_BREADTH_PLAN=1`. Feed its requests to
`decision-evidence-breadth-replies.py` and repeat the audit with plan
mode off. For the model experiment run
`decision-evidence-human-candidates.py` and
`decisionHumanCandidateAudit.test.ts`. Finally run
`decision-evidence-breadth-score.py` with the checked-in references
and the four general cohort names, excluding the focused challenges
from the general subtotal. Use `--human-proofs` for the nomination
comparison. The environment used Python 3.13, python-chess 1.999,
PyTorch 2.10.0+cpu and Maia source
`1e13597c42d4858b7cfd7cfdae01e297263364b2`. The Maia-3 5M checkpoint
SHA-256 is `ba14208b2992d85502f5fb501934abf6aaaeb355e9f3fdf90e326911f562524f`.
Generated searches, the model and its environment stay outside
the repository.

### Prospective 2026 tournament test

The restricted Maia policy and deployment criterion were recorded
before opening this evaluation. A stable hash selected one
position per game without scores. The set contains 14 positions
from the Reykjavik Open, 11 from the Prague IM Open and 8 from
the World Amateur W2000. The PGN headers verified that all
games took place in 2026, after the checkpoint training period.
References used ordinary legal Stockfish lines and independent
played-move replies before the candidate output was produced.
[Reykjavik Open round 7](https://lichess.org/broadcast/reykjavik-open-2026/round-7/50qoddPB)
[Prague IM Open round 7](https://lichess.org/broadcast/prague-open-2026-im-open-a/round-7/BefBmCXr)
[World Amateur W2000 round 6](https://lichess.org/broadcast/fide-world-amateur-chess-championships-2026-w2000/round-6/s7aCtYoA)
[Maia-3 checkpoint card](https://huggingface.co/UofTCSSLab/Maia3-5M)

| Route | Extra moves checked | Recorded extra moves retrieved | Tactical TP / FP | Positional TP / FP | Mixed TP / FP |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original three-line replay | 0 | 0 of 9 | 1 / 0 | 5 / 0 | 0 / 0 |
| One Stockfish nomination | 33 | 4 of 9 | 6 / 0 | 5 / 0 | 0 / 0 |
| Maia top-two nomination | 20 | 2 of 9 | 2 / 0 | 5 / 0 | 0 / 0 |

The denominator for verified tactical detection was 18 positives
and 10 negatives. For positional it was 26 positives and 3
negatives. For mixed it was 11 positives and 13 negatives. Five,
four and nine boards, respectively, were uncertain. Review came
from one engine-assisted reviewer. Among the 20 boards eligible
for Maia, each nomination method retrieved two recorded moves.
Stockfish verified two tactical episodes there and Maia verified
one. Both methods selected `...Kf7` in Prague position
`df19808cae4b3b87-55`. Stockfish corroborated the material
consequence of `Nxc8` compared with `...Bd7`.

The nomination search and reply budgets totalled 34M additional
nodes for Maia and 53.6M for the Stockfish extra-choice route.
Stockfish also used 55.8M nodes to nominate from an eight-choice
frame. Per-board median Maia request time was about 65 ms on one
CPU thread. Analysing all eight deeper lines directly reached
eight positional true positives and zero false positives at
223.2M root nodes. It found just one tactical true positive and
zero mixed. This did not preserve the positional result of the
development comparison in the same direction.

The frozen neural criterion required two additional tactical
true positives and zero additional false positives. Maia added
one. The app keeps v31, and the extra-choice search is an
experimental alternative. The evidence favors investing in
cheaper Stockfish nomination and verifying the relevance of
each refutation to the position before adding a runtime. The
mixed and positional coverage gaps remain open. A future
position-level result should review the explanation itself as
well as its agreement with the tactical axis.

For the prospective comparison use the manifest, reference and
freeze receipts in `benchmarks/decision-evidence/maia-nomination-v32`.
The bench uses the production tactical core at `348f5540` and
the experimental tooling at `b6171e2b`. Reproduce the nomination
with `--policy-max-rank 2`. The freeze receipts hash the original
Windows JSON bytes with CRLF line endings. If Git checks out these
manifests with LF, restore CRLF when verifying the byte hashes.

## Iteration 33 — one extra choice when the position is unresolved

The position panel now has a second stage for unresolved tactical
evidence. A 90,000-node search of up to six moves proposes the first
choice outside the original ranked list. A 1.2M-node paired search
must retain the same leading move and agree with its original
evaluation. It must also show a meaningful loss after the extra
choice. Stockfish then gets up to 1M nodes to analyse the opponent's
replies independently. Each stage uses the same game history and the
existing 28-second search deadline. An unavailable extra search
leaves the original report usable.

The verifier requires the same legal first reply in the two searches
of the extra move. The reply must win material immediately or reach
the verified payoff by the opponent's next turn. The continuation
can go further to establish that the exchanges settle. This
requires a concrete change in what the opponent can do. A position
with a longer tactic can still receive that explanation through the
normal played-move analysis. The extra branch only changes the
position report, with both variations available under Show evidence.

### Development and cost comparison

| One extra Stockfish move | Nomination budget on 124 boards | Added tactical TP / FP on 124 reviewed boards | Added tactical TP / FP on 33 reviewed 2026 boards |
| --- | ---: | ---: | ---: |
| Original wider search | 285.0M nodes | 5 / 1 | 5 / 0 |
| Short three at 60,000 nodes | 7.44M nodes | 3 / 1 | 0 / 0 |
| Short six at 90,000 nodes | 11.16M nodes | 5 / 1 | 5 / 0 |
| Short eight at 180,000 nodes | 22.32M nodes | 7 / 1 | 4 / 0 |
| Short six with independent early-payoff confirmation | 11.16M nodes | 4 / 0 | 5 / 0 |

The table reports the nomination budget separately from the work to
verify a move. The raw variants used the same paired and independent
reply searches as v32. The 124 boards include one reviewed false
positive from `...Nh5`: a later deflection was real in the
hypothetical mistake, but the payoff came too late to supply
position-level evidence on its own. The early-payoff requirement
excluded it and one correct diagnosis on development. The 33 boards
had already been reviewed in v32 and were reused to compare search
cost. Neither comparison served as the new held-out test.

### Held-out evaluation

The frozen candidate was tested on 36 more games. A stable hash
selected one eligible position per game. The three cohorts contain
12 games each. References were reviewed from ordinary Stockfish
root lines and played-move probes before viewing the new candidate
reports. [European Women's Championship, round 7](https://lichess.org/broadcast/25th-european-womens-chess-championship-2026/round-7/4jWpo2Ap)
[Dutch Open, round 4](https://lichess.org/broadcast/dutch-open-2026-dutch-open/round-4/foOkbJHh)
[World Amateur U1700, round 7](https://lichess.org/broadcast/fide-world-amateur-chess-championships-2026-u1700/round-7/PyXN5Fq9)

| Position question | Reviewed positives / negatives | Legacy TP / FP | v31 TP / FP | v33 TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 21 / 9 | 3 / 0 | 5 / 0 | 6 / 0 |
| Positional | 27 / 6 | 0 / 0 | 4 / 0 | 4 / 0 |
| Mixed | 12 / 15 | 0 / 0 | 0 / 0 | 0 / 0 |

Six tactical, three positional and nine mixed references were
uncertain. The added tactical detection is the European Women's
Championship position `e820fb095b7c05d0-42`. The short search
nominates `Nf6+`. Both Stockfish searches find `...Qxf6`, and
the resulting exchanges leave White down about a minor piece.
`Nd2` avoids that immediate capture. The wider context still
contains threats from `...Nd3`. The new evidence covers one
concrete decision in that position.

The additional stage ran on 31 of the 36 boards. The paired
comparison warranted an independent reply search on nine, for
49.0M additional requested nodes altogether. The median extra
engine time was about 1.38 seconds on this test PC, with concurrent
evaluation workers. Median classifier time was about 24 ms,
excluding engine search and legacy motif extraction. The committed
tactical core reproduced all reports, and the v31 assessment on
the same inputs matched the v33 control. The move and mistake
assessments matched the control on every board. Tests passed
129 cases with one existing skip. The source panel and worker
displayed the extra comparison and both legal lines at 320, 390
and 900 pixels using recorded Stockfish evidence. Installed
desktop verification is pending.

**Reproduction.** Generate the ordinary root and reply caches for
the sample in `benchmarks/decision-evidence/extra-choice-v33` using
the v29 settings, profile `v33`. Run
`decision-evidence-quick-nomination.py SAMPLE ENGINE OUTPUT
--root-cache ROOT_CACHE --profile six90k`, naming the output
`quick-nominations.json` in the audit directory. Use the ordinary
shared- and position-reply flags and set
`DECISION_AUDIT_EXTRA_CHOICE=1` for the freeze and candidate audit.
The result includes `assessmentWithoutExtraChoice` for the
same-board comparison. For the development replay, use the
v32 breadth and candidate files with `--old-candidates`, then
run `decisionQuickNominationAudit.test.ts`. The held-out result
supports a narrow tactical improvement. Broad positional and
mixed diagnosis still need evidence beyond this extra reply.

## Iteration 34 — train on verified refutations

The Maia experiment ranked likely human moves. This experiment learns which
candidate will yield an independently corroborated tactical refutation. All six
methods see the same legal Stockfish shortlist at 90k nodes and nominate one
move outside the original three. The learned inputs describe the current board,
shallow score and rank, and the captures, material changes, checks and piece
attacks in the first six plies. The network only ranks the moves. The existing
1.2M-node comparison and independent 1M-node reply decide whether to supply
evidence, and the position receives an additional tactical label only when
the ordinary report has no such evidence.

Two small, regularized, two-layer networks compare ordered plies with coarser
summaries of the same line. Each is the average of three fixed seeds. A
logistic model, shallow tree, explicit shallow-reply rule and current Stockfish
ranking are controls. The training data contain 672 candidate moves on 217
previously used positions across 14 events. The verifier accepted 52 moves on
40 positions. A positive therefore means the particular verifier found a
concrete refutation within its search and attribution limits. Some grouped
neural fits reached the 400-iteration cap.

| One extra candidate | Development refutations, one event held out at a time | Fresh general refutations | Fresh tactical TP / FP |
| --- | ---: | ---: | ---: |
| Stockfish shortlist order | 12 | 2 | 6 / 0 |
| Shallow score and reply rule | 22 | 1 | 5 / 0 |
| Logistic, ordered plies | 26 | 1 | 4 / 0 |
| Shallow tree, ordered plies | 25 | 2 | 4 / 0 |
| Neural, pooled plies | 23 | 1 | 5 / 0 |
| Neural, ordered plies | 23 | 1 | 4 / 0 |

The primary holdout has 30 games from two events. One position had no
eligible extra search. Seventeen positions have positive tactical references,
five have negative references and eight are uncertain. All routes had two
positional true positives and zero mixed true positives, with zero false
positives on either axis. There are five reviewed mixed positives. The
separate 12-game passed-pawn challenge had no admissible refutation from any
shortlisted move. It measures the limits of this verifier on those positions.
Both cohorts were reviewed from the ordinary Stockfish lines and played-move
replies before seeing the new rankings or proof outcomes. They have one
engine-assisted reviewer and contain few reviewed negatives.
[English Championship round 5](https://lichess.org/broadcast/english-chess-championships-2026-open-classical/round-5/NnatVMOS)
[Cappelle Open round 6](https://lichess.org/broadcast/42e-open-international-de-cappelle/round-6/nB4RvHlB)
[British Championship round 5](https://lichess.org/broadcast/2026-british-chess-championships-championship/round-5/CetqRZ1r)
[Hastings Masters round 7](https://lichess.org/broadcast/hastings-international-chess-congress-2025-masters/round-7/3tbqgj4g)

Searching every extra candidate from the frozen shortlist establishes five
verified refutation positions, three with positive tactical references.
The baseline before extra moves has four true positives. Perfect
selection would take it to seven, one above the current Stockfish ranking.
For example, in Cappelle position `22c025cc325b9d36-32`, Stockfish nominates
`Bg1` and both searches find `...exf4`. `fxe5` prevents the capture.
The ordered network nominates `Nb5`, which yields no corroborated proof.
The ordered network's only test proof was on a position with an uncertain
tactical reference. Its replay uses the same 47.54M additional requested
engine nodes as Stockfish on the general cohort.

The frozen promotion gate required two additional reviewed tactical
positives with no extra reviewed false positives. This candidate missed
that gate, and the exhaustive result gives a ceiling below the gate for
any ranker over these same moves. The event holdouts in development
overstated transfer to this small future-game sample. The result supports
keeping the trained models in research. Learning the class of verifier
proofs studied here also provides no evidence of improved positional or
mixed explanations.

**Reproduction.** Use the public manifests, independently saved reference
labels, freeze and compact result receipt under
`benchmarks/decision-evidence/neural-refutation-v34`. The production evaluator
for this experiment is `a29025d9`. Reproduce the v32 breadth roots, the v33
ordinary roots and all six-choice nomination caches. Use
`decision-evidence-refutation-candidates.py` to consolidate the development
inputs, run `decisionRefutationRankerAudit.test.ts` with
`DECISION_REFUTATION_SEARCH` and `DECISION_REFUTATION_LABELS`, and give the
result to `decision-evidence-refutation-ranker.py`. Give the ranker only
the `--shortlist-only` holdout input and freeze its nominations before scoring
test proof outcomes. Rerun the collector with independent searches enabled,
use the same audit to label their results and run
`decision-evidence-refutation-score.py` against the ordinary v33 candidate
audit with extra choice disabled. Development and holdout proofs replay
byte-for-byte after formatting the audit source. Exact file hashes use the
original line endings. Run the Python benchmark with python-chess 1.999
and scikit-learn 1.9.1. Engine caches and trained models stay outside Git.

### Positional comparison on the same frozen games

A separate candidate compared strategic plans across legal continuations
that settled their exchanges at different plies. It followed the same
passed pawn and supporting or blockading rook, and required agreement
on material changes in the nearby files. On 160 earlier development
positions, the candidate added three reviewed positional positives
without a new reviewed false positive. One already had tactical
evidence and became mixed. In that World Amateur game, `a7` and `Kh1`
both met `...Ra8` against the same passed pawn, while unrelated exchanges
on the other wing had previously defeated the comparison.

The candidate produced identical assessments to the committed
strategic comparison on all 30 general and 12 challenge boards.
The benchmark uses the ordinary Stockfish frames for both versions.
The challenge selected six games with an advanced passed pawn that
remained for six plies and six with an early capture or promotion.
The selector in `decision-evidence-passer-sample.py` uses the recorded
game only to choose a sample. The recorded pawn trajectory supplies
neither the tactical nor positional reference. This positional change
remains experimental because the frozen evaluation established no
gain. The shortlist findings point to the limited set of explanations
that search can verify given its current branches and checks.

## Iteration 35 — material recovery and mating replies

The earlier verifier expected a short tactic to leave a material gain
or appear in the principal reply. That can hide two different reasons
to calculate a move. A fork can recover a piece after an apparent loss.
A check can force an accurate evasion even when the best reply prevents
mate. Both evidence paths now reuse the ordinary root and reply searches.

- **Recovery after a capture.** The root and independent reply searches
  must show the same capture, fork and payoff. The verifier checks that a
  direct recapture would not already recover the piece, then accounts for
  the opponent's recapture on the fork target. It retains the fork on
  its actual ply and describes recovery. It does not credit the opening
  move with winning a new piece or infer an unrelated mistake.
- **Mate after an evasion.** The checker requires a legal root check and
  a separately searched reply frame with a finite best reply. A weaker
  legal evasion must have a complete mating line. The local proof checks
  the mating attack against every legal answer to its first move. The
  report identifies the evasion and the safer engine reply and shows the
  mating continuation under Show evidence.

In a reviewed development game from Cappelle, `...cxb6 Qxd3 ...e4`
forks the queen and knight. After either queen retreat in the two
searches, `...exf3` takes White's knight and `Qxf3` returns the pawn.
A second development game recovered a mate after `...Bxd6+ Kg2`
that the main line avoids with `Rxd6`. The new tactical position evidence
covered both previously missed examples in a 78-board development
scan. No held-out board supplied a recovering fork through the new rule.

| Frozen position cohort | Boards | Reviewed tactical positives | v33 tactical TP / FP | v35 tactical TP / FP | Positional TP / FP, both | Mixed TP / FP, both |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary classical games | 32 | 14 | 10 / 1 | 10 / 1 | 7 / 0 | 0 / 0 |
| Recorded checks with two to five evasions | 12 | 8 | 4 / 0 | 4 / 0 | 1 / 0 | 0 / 0 |
| Broadcast-annotation evasion sample | 11 | 8 | 3 / 0 | 5 / 0 | 1 / 0 | 1 / 0 |
| Independent legal mate branches and controls | 20 | 17 | 9 / 0 | 12 / 0 | 0 / 0 | 0 / 0 |

The 32 ordinary boards came from Bavarian Open and Trois Vallées.
The 12-board challenge uses one recorded check per game from the
Polish semifinal, with a stable hash choosing among checks allowing
two to five legal evasions. Two supplementary cohorts came from
the European Youth Girls U18 and Bengbu Open. The first selected one
finite-to-mate annotation and ten stable-evaluation evasions. The
second used an independent python-chess enumeration to select ten
boards where a recorded check has a short checking mate after one
evasion and at least one defence outside that proof, and ten boards
without a checking mate within two. Samples were kept disjoint by
game and selected board. These targeted sets measure conditional mating
branches, and their class frequencies differ from ordinary play.
[Bavarian Open](https://lichess.org/broadcast/29th-open-bavarian-chess-championship/round-6/lPRvr2du)
[Trois Vallées](https://lichess.org/broadcast/tournoi-des-trois-vallees-2026/round-4/ZKsR0tLj)
[Polish semifinal](https://lichess.org/broadcast/pofinay-indywidualnych-mistrzostw-polski-2026-open/round-4/uMqzNaDV)
[European Youth Girls U18](https://lichess.org/api/broadcast/EQTA1dP9.pgn)
[Bengbu Open](https://lichess.org/api/broadcast/3yQeQYED.pgn)

References came from one engine-assisted review saved before the
candidate output, using ordinary root lines and recorded replies.
The independent selector supplied challenge cases and controls,
with tactical and positional labels reviewed separately.
The supplementary sets added five reviewed tactical positives with
zero added false positives. For example, in a Girls U18 queen ending,
`...Qh7+ Kg4` allows mate in two starting with `...f5+`, whereas the
engine prefers `Kg2`. The move report also retains a mating branch for
some played checks outside the position's competitive band, such as
`...h2+ Kxh2 ...Qh3+` in Bengbu. The overall position category does
not use that weaker root choice. Mistake reports matched the baseline
in all 75 positions. Positional and mixed coverage still need work.

No new engine queries are required. The added proof avoided 11.74M
requested optional nodes over the 31 supplementary positions.
Median classifier time on the ordinary set was 26.5 ms for v33
and 27.7 ms for v35, excluding engine searches. The committed tactical
core reproduced the assessments on the 44 initial boards. The
source panel and worker replayed the recovery and mating examples in
Chrome at 320, 390 and 900 pixels and verified keyboard access to both
evidence lines. Installed desktop verification is pending.

**Reproduction.** Samples, separately reviewed references, freeze
receipts and a compact report are under
`benchmarks/decision-evidence/defensive-resources-v35`. Use the
ordinary root, reply, shared-reply and six-choice nomination commands
from v33 with profile `v35`. Run the candidate audit with all three
optional verification flags enabled, scoring both the candidate and
the v33 comparator on those same searches. The two supplementary
manifests come from `decision-evidence-mating-defence-sample.py`, with
`--legal-witness` for the independent sample. Input file hashes use
the original bytes. The two Python sampler tests and four new
classifier regressions cover branch legality, the missing independent
proof, and unavailable mating evidence. The focused TypeScript suite
passed 133 tests with one existing skip.

## Iteration 36 — compare the duty of a rook or queen toward a passer

The earlier strategic plan check favours compatible material windows
and quiet moves. That can miss a combination whose strategic reward
is continuing control of a passed pawn. This experiment follows the
same pawn through the existing legal Stockfish variations. It checks
three concrete effects.

- A newly placed rook legally recaptures the enemy rook if it takes
  the passer, while a worse choice allows that exact capture.
- A rook blockades a promotion square across several plies. A different
  choice may let the same pawn promote, or a comparable choice may
  remove the pawn with a different piece once the blockade has served
  its purpose.
- The same queen stays in place across two comparable move orders and
  is eventually exchanged to remove the promoted pawn.

The frozen candidate added four positional positives in a replay of
153 earlier positions. Two had tactical evidence already and became
mixed. For example, `Rg8+` gains time for `Ra8`, which defends the a4
passer from the opposing rook. `Kd5` allows `...Rxa4`. A separate
Bavarian game shows the d8 rook keeping a d7 passer under control after
`...Qxb1+`. In the `...Qf6` line, that rook is exchanged and the same
pawn promotes. Legal recapture and promotion, rather than material
change by itself, supply the evidence in these examples.

| Frozen cohort | Boards | Tactical TP / FP, both | Positional TP / FP, both | Mixed TP / FP, both |
| --- | ---: | ---: | ---: | ---: |
| Ordinary classical | 25 | 6 / 0 | 3 / 1 | 0 / 0 |
| Advanced passed-pawn challenge | 12 | 4 / 0 | 1 / 0 | 0 / 0 |
| Rook blockade challenge | 8 | 1 / 0 | 3 / 0 | 0 / 0 |

The frozen candidate and v35 produced the same assessment, apart
from the experimental schema version, on every board. No new engine
queries were needed. On the ordinary sample, 15 of 17 missed positional
positives had no passed pawn advanced to at least its fourth rank.
None had an enemy seventh-rank passer with a defending rook on its
promotion square. The specialised rule has little opportunity to
improve ordinary positional recall. Even when all eight boards began
with the exact rook blockade, the available lines did not reach the
candidate's comparison conditions.

A follow-up replay on exposed development data allowed two different
positions to reach the same capture of the passer and allowed more
time for the same pawn to promote after the blockade ended. This
recovered two additional reviewed positional positives in the
blockade sample. For example, `...b3` and `...Kf8` both ultimately
permit `...Rxa7`, with different position layouts at the capture.
Neither gain is a new held-out result. Across all 198 development
positions, the follow-up has six positional additions including two
mixed, with zero added reviewed false positives. The feature remains
experimental. The ordinary misses also include central pawn breaks,
file control, and defensive coordination that do not involve a passer.

The ordinary cohort used completed classical games from Box Hill
and World Seniors Open 65+. The passed-pawn cohort used Limerick and
World Seniors Open 50+. The blockade sampler drew four persistent
and four early-ending blockades from separate games in Cascade,
Blumenau, Castel del Rio and Cap Negret. It also considered the German
Amateur Group C event. The selector uses recorded board states and no
evaluation scores. Each benchmark has a single engine-assisted review
written before its classifier output.
[Box Hill](https://lichess.org/broadcast/2026-box-hill-open/round-3/UkH5b5BS)
[World Seniors Open 65+](https://lichess.org/broadcast/fide-world-senior-chess-championships-2026-open-65/round-7/32qHAwIa)
[Limerick](https://lichess.org/api/broadcast/fYHaW9yz.pgn)
[World Seniors Open 50+](https://lichess.org/api/broadcast/yVOLKime.pgn)
[Cascade](https://lichess.org/api/broadcast/4YTdiRuu.pgn)
[Blumenau](https://lichess.org/api/broadcast/eAhfBfzx.pgn)
[Castel del Rio](https://lichess.org/api/broadcast/yZyZOsAy.pgn)
[Cap Negret](https://lichess.org/api/broadcast/9xj1Ehti.pgn)
[German Amateur Group C](https://lichess.org/api/broadcast/rNb7bbYI.pgn)

**Reproduction.** Samples, reviewed labels, freeze receipts and the
score summary are under `benchmarks/decision-evidence/passer-choices-v36`.
The frozen code is preserved as `candidate-v36.patch` against
`e04d3b3b`. Apply it in an isolated research workspace with
`git apply --unidiff-zero`. The independently preserved
`post-review-variant.patch` applies on top of it for development
replay. Generate the existing root and reply profiles under `v36`
and use the ordinary candidate audit with all three optional
verification flags on. Rebuild the focused sample with
`decision-evidence-passer-sample.py --rook-blockade --per-stratum 4`.
Five prototype regressions passed within the 138-test focused suite.
The blockade sampler regression and the frozen-input and grouping
checks also passed.

## Iteration 37 — common pawn breaks and rook exchanges

The earlier strategic comparison could miss a shared plan when two
viable moves reached it at different plies. Temporary material gains
during a chain of recaptures could also hide a structural effect that
lasted after the exchanges. A new position-level comparison replays
the legal lines and looks for two kinds of shared evidence.

- The same central pawn advance contacts the same enemy pawn in two
  move orders. An observed exchange clears a named file of one side's
  pawn or pawns. The file stays clear through later moves, and material
  is checked after the exchanges settle.
- The candidate lines exchange opposing rooks on the same open file.
  At least one rook must prepare the trade. If the trades happen on
  different squares, one root choice must participate in the rook
  manoeuvre or trade on that file. A pair of unrelated later exchanges
  gives no position-level conclusion.

Both explanations give the two legal continuations under Show
evidence. They describe a strategic interpretation of observed board
changes. The feature carries no assigned share of Stockfish's score.

| Development replay on 198 earlier public positions | Added positional TP / FP | Added mixed TP / FP |
| --- | ---: | ---: |
| First comparison | 7 / 1 | 2 / 2 |
| Wait for the central exchange to settle and require relevant rook placement | 8 / 0 | 2 / 1 |
| Also settle an exchange at the end of the observation window | 10 / 0 | 2 / 1 |
| Allow actual rook use of the opened file to substitute for neutral material | 10 / 0 | 2 / 1 |

The final row gave no additional positives. The production candidate
uses the preceding variant. Its development mixed false positive
already had a tactical false positive before the positional evidence
was added. The comparison distinguishes assessment by axis and by the
joint label, since they can move in different directions.

| Frozen cohort | Positions | Tactical TP / FP, both | v35 positional TP / FP | v37 positional TP / FP | Mixed TP / FP, both |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary classical | 32 | 4 / 1 | 7 / 0 | 7 / 0 | 0 / 0 |
| Structural challenge | 18 | 1 / 0 | 4 / 0 | 7 / 0 | 0 / 0 |

The three additional findings in the challenge were pawn breaks. In
the German league game `88ded0192e37d6ce-61`, Black can play `...f6`
immediately or after `...Rh8`. In both lines `gxf6+` clears Black's
f-file. Black can recapture with the king or knight. In the Slovenian
game `4d855e66d9c12e96-64`, White can play `d6` before or after `c5`
and the resulting exchanges leave Black with no pawn on the c-file.
All three new findings were reviewed as mixed. The separate tactical
analysis missed their tactical dimension, so the app displayed
positional evidence only. The same-file rook trade has regression
coverage and a reviewed development example. It added no positives
in the frozen cohorts.

The ordinary sample drew one position per game from the Brazilian
Women's Championship, Aruba Open Championship, and Mona Karff
Memorial. The focused sample uses six recorded open-file rook trades,
six central pawn contacts resolved by capture, and six contacts held
in the next four plies. Every focused board was independently
reviewed as positionally relevant, so that cohort measures recall
and provides no positional specificity estimate. The ordinary sample
has two reviewed positional negatives. A single engine-assisted
reviewer saved the labels before the candidate output was read.
[Brazilian Women's Championship](https://lichess.org/api/broadcast/tGKQocRe.pgn)
[Aruba Open Championship](https://lichess.org/api/broadcast/ZPONzjmY.pgn)
[Mona Karff Memorial](https://lichess.org/api/broadcast/n6gSt9Lm.pgn)
[Slovenian Team Championship](https://lichess.org/api/broadcast/OeslJUKC.pgn)
[German 2nd Bundesliga North](https://lichess.org/api/broadcast/VPkavlL1.pgn)

The candidate uses no additional engine searches. The optional
engine node totals and the move and mistake reports matched the v35
comparator. On the ordinary set the median classifier time was 31.4 ms
for v35 and 31.3 ms for v37, excluding engine searches. A replay with
the committed tactical module reproduced all 50 candidate assessments.
The focused suite passed 138 tests with one existing skip. The real
worker and source panel showed both verified facts and legal branches
with keyboard access at 320, 390 and 900 pixels. Installed desktop
verification is pending.

**Reproduction.** Use the public manifests, reviewed references and
freeze receipts under `benchmarks/decision-evidence/shared-structure-v37`.
The frozen comparator is `47176ab2`. Rebuild the focused sample with
`decision-evidence-structure-sample.py`. Its recorded game moves
select the stratum and do not determine the labels. Generate the
ordinary root, reply, shared-reply and six-choice caches under the
`v37` profile and run the standard candidate audit with all three
optional verification flags. The compact summary also retains the
development counts for each tested variant.

## Iteration 38 — look for a tactical decision inside a viable line

The root comparison stops short of asking whether a viable move is viable
only because a specific reply avoids a tactic. For this experiment, replay
the first two Stockfish choices within 50 centipawns of the leading score.
Nominate a board where the recorded move delivers check or creates a new
immediate capture threat which the engine's reply answers. Search the
board with three candidates and check one alternative reply independently.
A cheap board comparison nominates the capture. It supplies no label.

Initial exploration covered 248 previously reviewed positions from the
v33–v37 public cohorts, including 184 without established tactical
evidence. Across up to five plies in each viable line it searched 321
boards with a candidate threat or check. The broad policy searched only
one board, with principal-continuation priority, and added 12 reviewed
positives and four false positives. It accepted routine
recaptures and unrelated threats after otherwise strategic choices.
The strict policy considers only the first three plies. A check must
have at most four evasions and the inferior one must permit confirmed
mate within six moves. A capture must match the threat that prompted the
search. After the first ply a capture threat must require a capture in
the leading defence, which removes the simple later knight retreat in the
Dutch Open control. Retain only a follow-up where the best move agrees
with the original line. For a material conclusion the independent reply
must match the capture, converge on the evaluation and leave a settled
material consequence under the existing comparison.

| Development comparison, one follow-up board | Follow-up searches | Added reviewed tactical TP / FP |
| --- | ---: | ---: |
| Broad, earliest eligible board | 112 | 13 / 4 |
| Strict, earliest eligible board and one corroboration | 107 | 6 / 0 |
| Strict, principal continuation first and one corroboration | 107 | 7 / 0 |

A second strict board with the same principal ordering and corroboration
rules added one more positive at a cost of 40M additional nodes in
development. The frozen policy searches one follow-up board at 750k
nodes and at most one reply at 1M nodes. It requires two net new
reviewed tactical positives and zero new reviewed false positives to
qualify for runtime consideration.

| Held-out position question | Positive / negative / uncertain references | Legacy root-motif proxy TP / FP | v37 TP / FP | Follow-up TP / FP |
| --- | ---: | ---: | ---: | ---: |
| Tactical | 23 / 10 / 12 | 7 / 0 | 9 / 0 | 10 / 0 |
| Positional | 39 / 4 / 2 | unavailable | 11 / 0 | 11 / 0 |
| Mixed | 17 / 14 / 14 | unavailable | 0 / 0 | 0 / 0 |

The 45 fresh positions come from different games across the Lugano
Standard Open, Montenegro Cup finals and four North American Youth
Championship sections. One engine-assisted reviewer saved the labels on
the ordinary search frame and played-choice comparison before the extra
search was run. Game and board identities were screened against the
earlier public benchmark manifests. Legacy results use first-choice
root motifs as a proxy for tactical position character. The candidate
has no new scoring head for move justification, mistake mechanism or a
specific motif.

- In an Open U18 game, after 19.O-O-O Ra7 20.Bd6, both searches agree
  that Bxd6 prevents a loss. After ...b6, Bxf8 wins the exchange even
  after Black recaptures. The reviewer also saw a strategic consequence
  of castling and using the d-file, but neither system recognised that
  axis. This raised tactical recall only.
- In an Open U14 game, after 30.Qd5+ Kf8, the two searches tie the
  move to mate in four beginning 31.Bb4+. The positional reference
  was positive and the tactical reference was uncertain. Keep this
  proof outside the measured tactical gain.

The follow-up searched 24 of 45 boards and required three separate reply
searches, a total of 21M new requested nodes. The median engine time was
711 ms among queried cases and the maximum was 1.90 s, measured with one
thread per process and four workers, excluding the original search and
UI time. Seven of the 24 follow-ups were at first-reply boards already
searched by v37, including six at depth 16 or higher. The candidate
missed the promotion gate and remains a benchmark. Reusing those
existing reply frames is a lower-cost branch to test. The small
sample and single reviewer limit the estimates, particularly for
mixed accuracy and specificity.

[Lugano Standard Open, round 1](https://lichess.org/api/broadcast/round/r2h3ZELp.pgn)
[Montenegro Cup, finals](https://lichess.org/api/broadcast/round/2cHuz9HO.pgn)
[North American Youth Open U14](https://lichess.org/api/broadcast/round/Xn4ayeXi.pgn)
[North American Youth Open U16](https://lichess.org/api/broadcast/round/kab5yVJr.pgn)
[North American Youth Girls U16](https://lichess.org/api/broadcast/round/1IgX8gCg.pgn)
[North American Youth Open U18](https://lichess.org/api/broadcast/round/WPIGkjno.pgn)

**Reproduction.** The manifest, labels, original policy digest and
compact receipt are under `benchmarks/decision-evidence/nested-counterfactual-v38`.
Run the standard root, reply, shared-reply and six-choice collectors
using profile `v38` and the v37 classifier at `20af76cb` for the
ordinary assessment. Make a JSON array with one row listing the cache
directory, profile, path to the reference and path to the ordinary
assessment. Give that manifest, the engine and a separate output
directory to `decision-evidence-nested-counterfactual.py --screen single`.
Set `NESTED_SCREEN` to that output and `NESTED_OUTPUT` to an unused
result file, then run `decisionNestedResearch.test.ts`. For this policy
overlay tactical support for rows with a matching defensive line and
a confirmed capture threat or mate. Score the three axes with the
ordinary reference evaluator. The committed runner reproduced all
35 evaluated records, including the 24 probed boards and both verified
proofs, apart from timings.

## Iteration 39 — deeper mate after a different check evasion

Stockfish sometimes returned a complete mating line for a worse check
evasion in an ordinary reply search. The decision classifier only
used this evidence for mate in one or two. The new branch evaluates
the supplied legal mate in three to five with the local mate prover.
The proof covers all legal defences, allows a nominated quiet attacking
move, and abstains at the fixed 8,192-node proof cap. The best defence
must still have a finite evaluation. The explanation names the
specific evasion that concedes mate and the move Stockfish prefers.
A line where the defender could have taken the attacking queen is
a regression control, even though that line reaches legal checkmate.

In development, the candidate rediscovered a known conditional mate
in four after Qd5+ Kf8. The tactical reference was uncertain. The
same cache supplied Kh8 as the stronger defence, so a follow-up
Stockfish query was unnecessary. The quiet one-move threat comparison
yielded zero new verified cases across 293 reviewed development
positions. The two strategic alternatives also had limited coverage.
A rook recapture candidate recovered the known d6 example. A quiet
minor-piece exchange whose pawn recapture leaves a lasting isolated
pawn recovered one example, and a bishop-pair exchange recovered
one more. Tests of different early routes using the existing
strategic actions added zero. The rook candidate changed none of
the 55 fresh reports and stays experimental.

| Held-out cohort | Positions | Tactical recall before | Tactical recall after | New reviewed tactical FP |
| --- | ---: | ---: | ---: | ---: |
| Ordinary games | 27 | 5 / 19 | 5 / 19 | 0 |
| Recorded rook recaptures | 12 | 1 / 8 | 1 / 8 | 0 |
| Broadcast annotations suggesting mate after a check evasion | 4 | 0 / 4 | 2 / 4 | 0 |
| Stable check-evasion controls | 12 | 3 / 6 | 3 / 6 | 0 |
| Combined | 55 | 9 / 37 | 11 / 37 | 0 |

There were eight reviewed tactical negatives and ten uncertain
tactical references. Legacy first-choice motif labels found 4 of
37 tactical positives with zero reviewed false positives, using
the same root analysis as a coarse position proxy. Positional
recall was 11 of 45 and mixed recall was 3 of 27 with zero
reviewed false positives for both v37 and v39. One engine-assisted
reviewer saved the references before viewing either candidate.
Recorded rook moves or broadcast scores only selected strata.
The four mating cases measure a focused challenge with limited
precision. The ordinary sample showed no gain.

In the Asian Nations Cup, after 41.Rh8+, the branch 41...Kf7
allows mate in five starting 42.Rh7+. The preferred evasion was
41...Ke7. In the Copa Revolución game, 46...Rg5+ 47.Kh4
allows mate in four starting with the quiet 47...Rf1. Stockfish
prefers 47.Kh3. The proof covers the White replies to Rf1 before
committing to the mating line. The candidate still missed that
position's strategic component, which concerned control of the
d-pawn and rook placement in other lines.
[Asian Nations Cup](https://lichess.org/api/broadcast/E2Ux0N0V.pgn)
[Copa Revolución](https://lichess.org/api/broadcast/4jZflFpE.pgn)

The change adds no Stockfish requests. The replay avoided optional
extra-choice probes totalling 3.58M requested nodes because existing
reply frames supplied the two proofs. Three move reports changed
and the mistake reports were identical. The 55 stripped-down reports
matched the earlier two-feature candidate exactly. The 157 focused
tests passed with two existing skips. The evidence panel and actual
classifier worker showed both held-out lines with keyboard expansion
in an isolated Chrome fixture at 320, 390 and 900 pixels. Installed
desktop verification remains open.

**Reproduction.** The dataset, references, policy freezes,
unpromoted rook patch and compact results are under `benchmarks/decision-evidence/conditional-mate-v39`.
The challenge selector is `decision-evidence-rook-and-evasions.py`,
and the ordinary cohort uses `decision-evidence-tournament.py`.
Use the committed combined manifest for the exact case claims.
No game appears in two separate strata. Run the standard engine,
reply, shared-reply and six-choice collectors at profile `v39`.
The control is `e6dcd837`. The first freeze included the rook
patch and the deeper mate code. The release freeze followed
removal of the rook candidate. Compare both variants with the
same ordinary cache and score with the saved references. A
replay against the committed earlier tactical module reproduced
all 55 release assessments.

## Iteration 40 — ordinary-game replay and two position scope fixes

The same worker used by the Tactics panel was replayed over 227
ordinary classical decisions from 21 events. The seven previous
cohorts supply one decision per game with duplicate boards and games
rejected. Cached reply and extra-choice searches use the same board
and frame identities as the original sample. This is a retrospective
development audit. Its counts are separate from the fresh sample.

| Position dimension | Reviewed positive / negative / uncertain | v39 TP / FP | v40 TP / FP |
| --- | ---: | ---: | ---: |
| Tactical | 118 / 47 / 62 | 48 / 2 | 48 / 1 |
| Positional | 182 / 25 / 20 | 47 / 1 | 47 / 0 |
| Mixed | 73 / 72 / 82 | 2 / 1 | 2 / 0 |

The legacy first-move motif proxy reached 30 of 118 tactical positives
with zero false positives. The new proof combines information about
choices, replies and consequences. The legacy motif proxy has no
positional or mixed dimension.

Forty of 73 reviewed mixed positions lacked evidence on both axes.
Twenty-three had tactical evidence only, eight had positional evidence
only, and two had both. In 16 of 135 positional misses, at least one
viable move already had positional evidence that failed the additional
position-level relevance check. In 107 misses an early legal line had
a persistent board change. That change alone does not establish why
the choice matters. Of 70 tactical misses, three had a supported mistake
explanation and none had a supported justification of a viable move.
Thirty had an early tactical witness in a root line. The remaining
case-level records and intervals are in the audit summary.

The replay exposed two attribution errors and motivates fixes at the
position level.

- Rf5 and Rfe1 in the Box Hill game both reached the same board after
  the rook took on e5. The shared line later placed a bishop on b4.
  The two copies of that later occupancy cannot establish the earlier
  position's character. The outpost check now considers whether the
  lines converged before the outpost appeared in either line.
- In a Trois Vallées game the extra candidate e5 simply allowed dxe5.
  That hypothetical move did not supply sufficient evidence of a
  tactical requirement in a position already explained by the c5
  break. The extra-choice path withholds the tactical label when its
  sole certificate is taking a pawn that was just advanced without
  a concrete additional threat. Existing named mechanisms, checks
  and directly threatened pieces still qualify. The separate mistake
  assessment retains the proved direct loss. A first draft excluded
  a second pawn advance, e3, even though it attacks the bishop on d2.
  Testing that control added a legal capture check for the threat.

A separate development candidate tracked rook pressure against the
same pawn across different viable lines. Eighteen positions had the
initial geometry. One relied on a demonstrated defensive response in
both lines, and two qualified when one line supplied the concrete
response. None added a mixed true positive. This candidate remains
experimental.

On 32 fresh ordinary positions from AQ Prime, Næstved Høst and
Misamis Occidental, v39 and v40 both found 5/17 tactical, 7/30
positional and 1/15 mixed positives. They both made one reviewed
positional and one mixed false positive. The two corrections
made no change on those 32 reports. One engine-assisted reviewer
saved those references before the comparison was run. The pooled
precision gains are development findings. Recall remains low,
especially for mixed decisions.
[AQ Prime](https://lichess.org/api/broadcast/chW5EdDC.pgn)
[Næstved Høst](https://lichess.org/api/broadcast/WvpmQdzN.pgn)
[Misamis Occidental](https://lichess.org/api/broadcast/7sIlRA7Q.pgn)

The changes request no additional engine searches. All candidate move
and mistake reports matched in both replays. The focused suite
passed 160 tests with three skips. The isolated browser
fixture replays the evidence with the actual worker at 320, 390
and 900 pixels. It shows the c5 plan under Position character, the
pawn loss under the distinct mistake analysis, and an unclear result
when the only proposed outpost arrives after a shared continuation.
Installed desktop verification is pending.

**Reproduction.** Use the source and reference identities in
`benchmarks/decision-evidence/ordinary-precision-v40`. The input to
`decisionOrdinaryReplay.test.ts` is a JSON array with `name`, `profile`,
`cache` and `reference` per cohort. The `cache` is the directory
containing the exact tournament sample and the ordinary, reply, shared
and six-choice search caches for that profile. Set
`ORDINARY_REPLAY_MANIFEST` and `ORDINARY_REPLAY_OUTPUT` to the input
and a new private output file. Run the test against `c1f6147c` and the
candidate, then run `decision-evidence-ordinary-replay-score.py`
with those two reports and a new output file. The sample freeze records
the source of the candidate before any fresh predictions were read.
Use the same replay harness when testing the baseline modules.
The worker audit above used the prior committed tactical module
because the working tree already contained an unrelated local edit.

## Iteration 41 — can a network find the mixed decisions the worker misses?

Train separate tactical and positional heads directly on reviewed
position character. The previous neural experiment learned which extra
move an engine could refute. This one learns from the resulting chess
position and its first three Stockfish choices. The aim is to prioritize
positions for further analysis. A chosen position still needs legal
evidence for both dimensions before it can receive a mixed diagnosis.

The experiment uses 259 ordinary classical positions from the v33–v40
worker replay, one position per game. The 24 broadcast sections form 21
tournament groups, with all four North American Youth Championship
sections in one group. Each fit excludes a whole tournament group.
Repeated games, board identities or events across the fit and its
evaluation are rejected. The features exclude player and event
information, the played move, and the reference and worker diagnoses.
The frozen worker result defines which decisions remain unresolved.

The score inputs use the leading evaluations and their differences,
material and the number of legal moves. The line inputs add actual
checks, captures, promotions and material changes over 12 plies, and
early or persistent changes in pawn structure, rook-file use, piece
activity and king cover. The linear, tree and two-layer neural models
share these inputs. Each neural result averages three seeded fits. The
two heads rank mixed decisions by the lower score. That score gives an
ordering and carries no probability interpretation.

| Ranking method | Tactical AP | Positional AP | Mixed AP | Mixed review picks (positive / negative / uncertain) |
| --- | ---: | ---: | ---: | ---: |
| Training prevalence | .600 | .801 | .446 | 10 / 15 / 16 |
| Scores, logistic | .937 | .926 | .766 | 25 / 3 / 13 |
| Lines, logistic | .968 | .981 | .854 | 25 / 2 / 14 |
| Lines, shallow boosted tree | .978 | .973 | .846 | 24 / 4 / 13 |
| Scores, neural | .956 | .952 | .780 | 22 / 5 / 14 |
| Lines, neural | .964 | .979 | .835 | 24 / 2 / 15 |

Average precision (AP) excludes uncertain references. The review budget
is one fifth of each event's unresolved boards, rounded down. Uncertain
boards can consume slots. The original worker finds 53/135 tactical,
54/212 positional and 3/88 mixed positives, with one reviewed false
positive on each. At 41 mixed review slots, the best model ranks 25
previously missed reviewed positives and two reviewed negatives in the
shortlist. These counts measure prioritization of reviewed positions.
Actual recovery requires a separate verifier replay.

The preset neural screen required at least .03 additional AP, two more
reviewed positives at the same budget, and no more reviewed negatives
than the simpler controls. Both neural variants fall short. With the
line network, the tactical queue finds 27 positives with one reviewed
negative, and the tree finds 28 with zero, at 31 slots. In the positional
queue, both the line network and the best controls reach 32 positives
and one negative from 33 slots. This leaves too little headroom for the
positional screen to pass on this cohort. The mixed screen has room to
detect an improvement. At 600 iterations 59 of 252 neural fits
reached the optimizer limit. At 3,000 iterations all fits converged.
Mixed AP moved from .835 to .834 for the line network and its review
counts stayed the same.

All 27 reviewed positional negatives occur in positions also reviewed
as tactical. The reference set therefore overrepresents tactical
negative controls for the positional question. Also, its existing
reviews used Stockfish lines, and the models learn from related lines.
Among the 135 reviewed tactical positions, the secondary positional
ranking has AP .942 for the line logistic model and .935 for the
converged line network. There are 88 positional positives, 27
negatives and 20 uncertain references in that slice.
Tournament exclusion reduces opening and event leakage. Shared review
practice can still make these results optimistic. This was a development
screen with no fresh holdout. Improving the references and testing a
shortlist through the legal verifier would establish whether the extra
review opportunities yield useful explanations. The runtime remains
at v40.

**Reproduction.** Reproduce the 227-board pooled and 32-board fresh
worker outputs described in v40, combined with the eight ordinary
cohorts in the replay manifest. Run
`decision-evidence-line-model.py WORKER_REPLAY MANIFEST OUTPUT`.
Use scikit-learn 1.9.1 and python-chess 1.999. Rerun with
`--network-max-iterations 3000` for the optimizer check. The compact
result receipt is in `benchmarks/decision-evidence/line-model-v41`.
The pilot reuses Stockfish caches and requests no additional engine
searches. The model weights and case-level research output stay out
of the repository.

## Iteration 42 — trace promotion pressure across choices

An advanced pawn can explain a lasting constraint even when the
immediate calculation concerns a different piece. For position character,
replay up to 14 legal plies from each of three Stockfish choices and
trace the same starting pawn through its advances and captures. A
strategic explanation compares distinct lines with an actual promotion,
sustained occupation of its promotion square by a blocking piece, or
observed removal. The comparison includes an immediate recapture when
the line provides one. Two immediate promotions do not establish
a continuing plan. Continuations that reach the same board before the
relevant evidence are treated as a single line.

A separate tactical explanation requires concrete evidence. In the
current rule, two alternative roots show the same pawn promoting on the
same square, being captured, and then being traded for the same type of
opposing piece. A third line shows a sustained blockade. The early
transaction is supported by Stockfish, and the strategic interpretation
describes the constraint illustrated by the legal lines. In the North
American Youth game `a00b09b2aac4793e-64`, `Ra1` gives White access to
`Re1` against the e-pawn. After `Rxa7` or `Kg2`, Black can promote
on e1 and obtain the white rook after the recaptures. The panel shows
three continuations with the longer verified branch replacing its
shorter duplicate.

| 259 previously reviewed ordinary decisions | Tactical TP / FP | Positional TP / FP | Mixed TP / FP |
| --- | ---: | ---: | ---: |
| v40 worker | 53 / 1 | 54 / 1 | 3 / 1 |
| Initial trajectory comparison | 54 / 1 | 61 / 1 | 8 / 1 |
| Also recognise resolved blockades and early removal | 54 / 1 | 64 / 1 | 10 / 1 |
| Also recognise the material cost of removing the pawn | 54 / 1 | 64 / 1 | 10 / 1 |

The second variant was frozen against a further 48 games. Its reports
matched the baseline in both strata. In a focused miss, Black gave up a
rook to take the pawn after occupying its promotion square for only
two plies. The third variant recognised that exchange after the miss
was reviewed. It recovered that one mixed example on the exposed
cohort. In the second evaluation, the second and third variants
performed identically. The less complex second variant is the release
candidate. [Stjernens Høstturnering](https://lichess.org/api/broadcast/JkAJY6gT.pgn)
[Tajik President's Cup](https://lichess.org/api/broadcast/7Mp0YNJB.pgn)
[ArcelorMittal Open](https://lichess.org/api/broadcast/kpCb2J5c.pgn)

| Frozen sample | Positions | Tactical true positives, both | Positional true positives, v40 → v42 | Mixed true positives, v40 → v42 |
| --- | ---: | ---: | ---: | ---: |
| First ordinary sample | 32 | 7/19 | 6/27 → 6/27 | 1/14 → 1/14 |
| First advanced-pawn sample | 16 | 2/13 | 2/13 → 2/13 | 0/10 → 0/10 |
| Second ordinary sample | 15 | 3/11 | 3/15 → 3/15 | 1/11 → 1/11 |
| Second advanced-pawn sample | 16 | 3/15 | 3/14 → 4/14 | 0/13 → 1/13 |

Neither evaluated version produced a reviewed false positive in these
79 games. The ordinary samples contain two positional negatives, and
the advanced-pawn samples contain one each. The advanced-pawn sampler
uses the recorded early removal or persistence of the pawn to select
games. The recorded play does not determine the reference label. The
first advanced-pawn sample draws 15 of its games from one event. The
second draws from three. One engine-assisted reviewer saved references
before reading each candidate replay. These samples establish a narrow
held-out improvement; ordinary transfer and the additional removal-cost
rule still lack positive held-out evidence.

In the newly recovered Farsala position `c5e9dbb7d21161f3-29`,
`Qxb6` removes the pawn before it can advance. The alternative
`Bxa3` allows `bxa7` and `axb8=R`, with the rook recapture shown.
The v40 report already established the tactical dimension. The new
comparison adds the precise pawn trajectory and the strategic
consequence of removing it early. Control from behind the pawn and
several cases of promotion after a played move outside the original
three choices remain outside this comparison.
[Farsala Open](https://lichess.org/api/broadcast/oDBlBcdo.pgn)
[NYC Fall Norms](https://lichess.org/api/broadcast/uxynWlhv.pgn)
[Intercollegiate Classical](https://lichess.org/api/broadcast/Tf2HPVdZ.pgn)

The new position checks use existing frames, with no extra engine
searches in the replay. Move justifications and mistake reports were
identical for all evaluated decisions. In the second advanced-pawn
sample the worker replay medians were 109.1 ms for v40 and 108.9 ms
for v42. These are concurrent-worker timings with cached engine data.
The focused suite passed 233 tests with one expected failure and
18 skipped tests. Type checks, scoped lint and formatting passed.
The actual worker and panel displayed the blockade, both promotion
transactions and three distinct continuations with keyboard access
at 320, 390 and 900 pixels in the isolated browser fixture.
Installed desktop verification is pending.

**Reproduction.** Use the samples, reviewed references and freeze
receipts under `benchmarks/decision-evidence/promotion-pressure-v42`.
Generate the ordinary Stockfish caches with the v40 settings and
profile `v42`. Rebuild the focused samples with
`decision-evidence-passer-sample.py --per-stratum 8` and the listed
board and game exclusions. In the replay manifest, specify
`strata: ["resolved-early", "persisted"]` for each advanced-pawn
cohort. Run `decisionOrdinaryReplay.test.ts` on the baseline and the
candidate and score the resulting worker reports. The replays
used the committed tactical core because the checkout contains an
unrelated tactical edit. The initial and removal-cost experiments
are recorded as patches against this iteration for
`git apply --unidiff-zero`, with separate results in the summary.

## Iteration 43 — distinguish a promotion concession from a pawn that was already winning

A game can end in promotion after the defender's best move. For mistake
mechanism, compare the actual played move with the better root in the
same search and check each choice against a separately searched opponent
reply. The evaluated loss must be at least 100 centipawns in the paired
frame, and the separate replies must corroborate the contrast. Trace
the original enemy pawn in both actual lines. It must promote by ply
eight on the same square and either retain the new piece for three
more plies or exchange it for the same kind of defending piece. Both
better lines must show the original pawn being taken or blockaded
without that promotion in the matched window. Sustained blockades can
add a separate strategic explanation. A promotion after another
candidate never establishes a mechanism for the played move.

In the Grand Swiss game `dae43ed4bcb442a6-102`, White's `d8=Q`
leads to `...Rxd8 Bxd8 ...Rc1`. The same black pawn from a2
then plays `...a1=Q Rxa1 Rxa1` in both searches, trading itself for
a rook. Both branches after `Be7` instead show White taking the pawn
on a2. The earlier classifier already recognised a tactical loss.
The new report identifies the exact promotion exchange and shows the
played and better lines. [FIDE Grand Swiss 2025 Open](https://lichess.org/api/broadcast/vSyxclHS.pgn)

The first held-out sample selected 15 classical games in which the
opponent promoted in the next six recorded plies, and 15 in which
an advanced enemy passer did not promote in that window. Most played
choices in both strata were sound on the later search. The second
sample selected 10 annotated evaluation losses of at least 100
centipawns and 10 annotated stable choices, all with advanced enemy
passers. The broadcast scores select cases. The references use the
paired and separately searched continuations. One engine-assisted
reviewer froze both references before running the paired worker replays.
Each sample has one position per distinct game. [Cap Negret 50+](https://lichess.org/api/broadcast/9xj1Ehti.pgn)
[European Youth U16](https://lichess.org/api/broadcast/em6k8D7g.pgn)
[Guernsey Open](https://lichess.org/api/broadcast/3PSWusGV.pgn)

| Held-out sample and question | Reviewed positives / negatives / uncertain | v42 TP / FP | v43 TP / FP |
| --- | ---: | ---: | ---: |
| Recorded-promotion sample, tactical mistake | 3 / 24 / 3 | 0 / 0 | 0 / 0 |
| Recorded-promotion sample, positional mistake | 0 / 26 / 4 | 0 / 0 | 0 / 0 |
| Recorded-promotion sample, mixed mistake | 0 / 26 / 4 | 0 / 0 | 0 / 0 |
| Recorded-promotion sample, specified promotion mechanism | 1 / 29 / 0 | 0 / 0 | 0 / 0 |
| Annotated-loss sample, tactical mistake | 5 / 11 / 4 | 2 / 0 | 2 / 0 |
| Annotated-loss sample, positional mistake | 5 / 11 / 4 | 0 / 0 | 0 / 0 |
| Annotated-loss sample, mixed mistake | 2 / 11 / 7 | 0 / 0 | 0 / 0 |
| Annotated-loss sample, specified promotion mechanism | 2 / 18 / 0 | 0 / 0 | 1 / 0 |

The 338-game development replay added a more specific explanation
after `...Rd8`, where the pawn from d6 takes on e7 and promotes on e8.
Checking a rook's legal captures of the promoted piece from behind
also found one development mixed mistake after `...Be1`, where the
alternative `...Ra2` covers a8. A further candidate compared
retention against immediate liquidation of a new queen and considered
corroborated mating evaluations. All three variations matched on the
50 held-out records. The simpler first version is integrated. The
broader experiments are preserved as patches. One missed European
Youth example reaches a different promotion payoff after `...Bg5`
than after `...Rb2`. The better reply snapshot was depth 15, below the
depth-16 validation gate shared by the application. Other misses
include later promotions and branches where the better choice generates
counterplay without taking or blockading the pawn in the available line.

The position and move reports match v42 across all 388 replays, with
the same optional search requests on the fresh games. On the
annotated-loss study, median worker replay time was 129.7 ms versus
130.4 ms. These timings include the cached worker analysis and exclude
engine search. The actual report panel shows both compared branches
through the existing Show evidence control at 320, 390 and 900 pixels.
This is a narrowly verified improvement in mechanism explanation.
Broader positional and mixed mistake recall remains open, along with
verification in an installed desktop build.

**Reproduction.** Use the sample, reference and freeze files under
`benchmarks/decision-evidence/promotion-mistakes-v43`. Sample the two
strata with `decision-evidence-passer-sample.py` using
`--promotion-mistake --per-stratum 15` and
`--annotated-promotion-decision --per-stratum 10`, respectively. Build
the v43 ordinary root, reply, shared-reply and six-choice caches
with the v42 search settings. Set `scope` to `mistake-mechanism`
and include both strata in the worker replay manifest. Run
`decisionOrdinaryReplay.test.ts` and score matching worker reports
with `decision-evidence-ordinary-replay-score.py --mistakes`. The
mistake scorer uses the actual move named by the reference and reports
promotion evidence separately from the tactical dimension. Use
`git apply --unidiff-zero` for either archived variant. The study
used the committed tactical core because the shared checkout
contains a separate tactical edit.

## Iteration 44 — retain a legal engine line that ends in a draw

The paired comparison for `51...Kb8` in the 2025 Grand Swiss was
discarded in full because the line after `51...Kc7` contained a king
move after both sides had run out of mating material. The same search
evaluated the better continuation at −0.27 and the played choice at
−4.04 from Black's point of view. Losing the whole pair hid a measured
3.77-pawn evaluation drop. The app now retries an otherwise invalid
paired comparison by truncating a near-equal exact-score continuation
at the first position with insufficient material. The full legal prefix
and the exact starting board must still validate. Ordinary position
and move assessments keep their existing validation, and the recovery
uses the existing engine result. [FIDE Grand Swiss 2025 Open](https://lichess.org/api/broadcast/vSyxclHS.pgn)

Four experimental mistake classifiers compared the same advanced enemy
passed pawn in two paired lines and in separate reply searches.

| Experimental candidate | New positional diagnoses among five earlier reviewed misses | New positional diagnoses in the 24-game sample |
| --- | ---: | ---: |
| A. Better choice removes the pawn and the played line leaves it passed | 1 | 0 |
| B. Also compare the material cost of stopping the same pawn | 2 | 0 |
| C. Also retain the legal drawing prefix in the paired comparison | 3 | 0 |
| D. Also verify that the better move can intercept a guarded advance | 3 | 0 |

In development, the first comparison recovered `Rc5` versus
`Rxe3`, when taking on e3 removes the advanced passer. Comparing
settled material after the pawn advances recovered `g3` versus
`Qf1`, where `d2 Rxd2 Bxd2 Qxd2` costs an additional 1.7
material points. Retaining the draw line recovered the `Kb8` versus
`Kc7` pawn comparison for the experiment. These results describe
earlier reviewed cases used to develop the rules.

One engine-assisted reviewer froze labels for 24 previously unused
games from four classical events before replays A through C. A later
inspection of that set exposed `...Kd7` versus `...Rf7`. The
short demonstration for D could verify `...Rxd7` against the pawn
advance and a rook-for-pawn cost in the played lines. In the complete
app replay, the two replies after `...Rf7` start with `Re5` and
`Re8`. The paired and separate searches do not meet the existing
reply agreement gate, so D still abstains. The first sample was
therefore development for D. [Limerick Congress](https://lichess.org/api/broadcast/fYHaW9yz.pgn)
[Rio Absolute](https://lichess.org/api/broadcast/0cfOqgVY.pgn)
[Asian Disabilities Open](https://lichess.org/api/broadcast/JwDV9Ju4.pgn)
[Asian Disabilities Women](https://lichess.org/api/broadcast/rUYNHzDG.pgn)

The independent check for D used a shallow Stockfish preview to select
three games with a different observed pawn outcome and three with the
same outcome. The original seven-per-group quota was reduced after 174
previews yielded three differences. The six-game references were
frozen before replay using the full engine searches. This targeted
sample measures transfer on these cases and is too small for a precise
population estimate. [Samarkand Olympiad Open](https://lichess.org/api/broadcast/n1pPI5Q0.pgn)
[European Club Cup Women](https://lichess.org/api/broadcast/seXJoc2H.pgn)

| Cohort | Question | Positive / negative / uncertain references | v43 TP / FP | Experimental TP / FP |
| --- | --- | ---: | ---: | ---: |
| 24-game classical pawn sample | Tactical mistake | 4 / 16 / 4 | 0 / 0 | 0 / 0 |
| | Positional mistake | 8 / 14 / 2 | 0 / 0 | 0 / 0 |
| | Mixed mistake | 3 / 16 / 5 | 0 / 0 | 0 / 0 |
| Six-game pawn contrast | Tactical mistake | 1 / 4 / 1 | 1 / 0 | 1 / 0 |
| | Positional mistake | 1 / 3 / 2 | 0 / 0 | 0 / 0 |
| | Mixed mistake | 0 / 4 / 2 | 0 / 0 | 0 / 0 |

The frozen promotion criterion for the experimental classifier required
at least one fresh positional true positive with zero new reviewed
false positives or lost tactical or positional diagnoses. The pawn
classifiers remain reproducible experiments. The source change is the
separate legal-prefix repair, which restores the evaluation comparison
and reports the mechanism as unclear. Its report differs from v43 on
one of 418 worker replays, the `Kb8` development case. The worker
requested the same optional searches on all 418. Median cached worker
time for the 24-game sample was 100.88 ms before and 89.49 ms after.
These are separate replay timings, with engine search excluded. The
existing panel displays the restored evaluation loss at 320, 390 and
900 pixels in an isolated browser run. The installed app is unverified.
The v41 legal-line neural ranker remains behind the logistic baseline
on its reported mixed-position experiment.

**Reproduction.** Use the tournament sample, reference and freeze
files in `benchmarks/decision-evidence/passed-pawn-mistakes-v44`.
The first set comes from `decision-evidence-passer-sample.py
--annotated-promotion-decision --per-stratum 12`. The second uses
`decision-evidence-pawn-contrast-sample.py --per-stratum 3`. The
published manifests are the fixed positions for reproduction. Generate
ordinary Stockfish 19 root, reply, shared-reply and six-choice caches
with the v43 search settings. Run `decisionOrdinaryReplay.test.ts`
with the manifest scope set to `mistake-mechanism`, then use
`decision-evidence-ordinary-replay-score.py --mistakes`. Each research
patch applies against v43 with `git apply --unidiff-zero`. The
comparison uses the v43 committed tactical core for both arms.

## Iteration 45 — verify that a shared reply actually contains a tactic

The played-move replay pooled 162 earlier reviewed decisions from 121
classical games. It used the actual played moves and retained the pairing
between each game and its control. The earlier classifier and the current
worker saw the same Stockfish 19 lines. On the tactical axis, the earlier
classifier found 7 of 35 reviewed positives with one false positive.
The v44 worker found 17 of 35 with zero false positives against 102
reviewed negatives. It found 4 of 31 positional positives and 2 of 8
mixed positives, with zero reviewed false positives in both dimensions.
The comparison is retrospective development evidence. Seventeen of 18
missed tactics already had an assessed played-move comparison.

Three experiments required a shared short tactical sequence, a concrete
change to the same threat after the alternative move, and a material
payoff in two separately searched lines. The first compared exactly
matched settlement plies. The second let the better lines settle before
a different exchange occurred in either better branch. The third also
tested a short capture sequence entered with check. The last two recover
`23...Qc2 24.Rc1 Nd4 25.Rxc2 Nxf3+ 26.gxf3` in development.
The better `23...Rxd1` removes the rook before it can attack the queen.
Both played continuations trade queens and lose the additional knight.
The paired and separate better lines complete later minor-piece trades
at different times. There are zero new labelled positives in either
fresh sample. [Asian Disabilities Women](https://lichess.org/api/broadcast/rUYNHzDG.pgn)

| Sample | Reviewed tactical positives / negatives / uncertain | v44 TP / FP | A TP / FP | B TP / FP | C TP / FP | Precision repair TP / FP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 162 earlier decisions | 35 / 102 / 25 | 17 / 0 | 17 / 0 | 18 / 0 | 18 / 0 | 17 / 0 |
| Ayr and Pall Mall, 18 decisions | 3 / 11 / 4 | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 0 |
| Pardubice, 16 decisions | 5 / 2 / 9 | 2 / 0 | 2 / 0 | 2 / 0 | 2 / 0 | 2 / 0 |

The exchange variants stay experimental. The first new sample contains
one annotated loss and one control from each of nine games. The second
contains 16 different games. A shallow 60,000-node preview nominated eight
short material-loss examples and eight forcing controls from 351 inspected
positions. Each sample uses independent games from the development pool.
The preview strata are sampling inputs. One reviewer saved the actual
mechanism references from the fuller searches before reading the replay
outputs. The instruction to repair the quiet reply came from inspecting
the Ayr results, which makes those results development evidence for the
precision change. Pardubice remained independent for that change. The
fresh samples have no reviewed mixed positives. All compared arms agree
on the position and move reports. [Ayr organiser and time control](https://www.congress.org.uk/congress/807/home)
[Pall Mall organiser's event record](https://s2.chess-results.com/tnr1474366.aspx?lan=20)
[Pardubice event rules](https://www.czechopen.net/en/chess/a-grandmaster-tournament/regulations-2)

In the Ayr example `25...Ne4 26.Bb4`, the old shared-reply verifier called
`Bb4` a tactical attack because the hypothetical `25...Nd5 26.Bb4
27.Nxb4` wins that bishop. After the actual `Ne4`, the bishop's reply
gives no check, takes nothing and has no immediate enemy target. The
control explains why White chooses a different move after `Nd5`. It
cannot establish a tactical consequence of `Bb4` after `Ne4`. The
verifier now also requires a tactical witness under the played move
before attributing the difference to the control capture. It accepts a
check, a materially profitable legal capture, a profitable follow-up
capture, a common capture of the original target in both variations, or
a legal immediate mate threat addressed by both searches. The local
capture and the full scored alternative remain required. The other
shared-reply episode checks still run. [Ayr Major round 2](https://lichess.org/broadcast/ayr-congress-2026-major/round-2/roVA3W1O)

The repaired report preserves the 1.35-pawn engine loss with an unclear
mechanism. One other Ayr case with an uncertain tactical reference
also becomes unclear. Development keeps both supported examples
`...Bc6 Bb5` and `...h3 Qc7`. They show a capture of the original
target by the same piece in two played searches. The source change uses
the existing engine requests. The panel with cached engine inputs
shows the repaired comparison at 320, 390 and 900 pixels. The installed
desktop build is unverified.

**Reproduction.** The fixed positions, labels, comparison summary
and experimental patches are under
`benchmarks/decision-evidence/played-mistake-replay-v45`. The older
v43 and v44 development manifests stay in their original benchmark
directories. Use Stockfish 19 and the ordinary v43 root and reply
options to regenerate the new root, reply and shared-reply frames.
The v23 historical development cohort has no shared-reply cache.
Run `decisionMistakeBreadthReplay.test.ts` with a manifest array
containing `name`, `path`, `profile`, `sample` and `reference`
for each source. Supply the manifest and a fresh private output
location through `DECISION_MISTAKE_MANIFEST` and
`DECISION_MISTAKE_REPORT`. Score the runs with
`decision-evidence-ordinary-replay-score.py --mistakes`. The replay
omits optional position-only searches for all arms to compare the
played-move evidence. Apply each experimental patch separately against
v44 using `git apply --unidiff-zero`. Keep the committed tactical core
fixed when comparing experiments.

## Iteration 46 — compare sustained rook pressure after a played mistake

Previous mistake comparisons mainly measured a new feature visible at the
root or a select pawn episode. That left out cases where the useful rook
setup arrives a move or two later. The new verifier compares the paired
root search and the separately searched replies after both the played
move and the stronger choice. It tracks the original rooks and opposing
pawn across those branches.

Both stronger lines must show the same rook placement or doubled rooks
pressing the same pawn for at least four consecutive plies, starting by
ply six. A rook must have a legal capture of that pawn somewhere inside
the matched window. The better root must move one of the rooks or open
the file with its pawn. The played lines must omit the same pressure and
must keep the original pawn on the board through the comparison. The
material balances can differ by at most one material point at the
comparison ply. These are observed conditions for a positional
interpretation. The app displays the two legal lines under Show
evidence. The calculation uses its existing searches.

In the Lugano case, both searches after `28.Ra5 Rde8 29.Rc5 Bc6`
show the rook on c5 attacking d5. After `28.Rfb1 Qb6`, White spends
the same early moves on the b- and e-files. The paired `Rfb1` line
reaches c5 later. The independent line goes elsewhere. The report
shows the 2.37-pawn evaluation loss and explains the earlier rook
activity within the matched window. [Lugano classical games](https://lichess.org/api/broadcast/uEsZ9lgJ.pgn)

The broader candidate also accepts a played branch that takes the
pawn at a clearly worse cost after recaptures settle. That recovers
an extra development example after `29.Rd2`. In both better lines,
`29.Ra2 Nc1 30.Rad2` doubles the rooks against d3. One `Rd2`
branch disposes of the same pawn with an extra 2.2-point material loss.
The two rules tie in both fresh samples. The narrower rule enters the
app. The broader comparison remains a reproducible experiment.
[Asian Disabilities Open](https://lichess.org/api/broadcast/JwDV9Ju4.pgn)

| Sample | Positional positives / negatives / uncertain | v45 TP / FP | Sustained pressure TP / FP | With costlier capture TP / FP |
| --- | ---: | ---: | ---: | ---: |
| 196 development decisions | 44 / 119 / 33 | 5 / 0 | 7 / 0 | 8 / 0 |
| Lugano and Brazilian Women's Championship, 14 games | 9 / 0 / 5 | 2 / 0 | 3 / 0 | 3 / 0 |
| Misamis Occidental, 16 decisions from 8 games | 5 / 10 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |

The first fresh sample uses a 60,000-node Stockfish preview and one
decision per game. A stricter three-position preview recovered only
one pressure nomination across 421 previews. The two-position preview
nominated four pressure cases and ten controls across 424 previews.
These strata describe the preview. The full searches supplied the
references through one engine-assisted reviewer, who froze each set
before opening classifier outputs. The second fresh sample selects one
annotated loss and one annotated control per game. These independent
controls provide reviewed positional negatives, which the first fresh
sample lacks. [Brazilian Women's Championship games](https://lichess.org/api/broadcast/tGKQocRe.pgn)
[Misamis Occidental tournament record](https://s3.chess-results.com/tnr1514595.aspx?SNode=S0&flag=30&lan=1&turdet=YES)

Across 226 replays the tactical and mixed scores, position character,
candidate move reports and evaluation losses are unchanged. The
Misamis sample has one existing tactical disagreement involving the
tempo `...Rxd7 Be5`. The benchmark reference treats the resulting
passed pawn as positional evidence. The worker also sees the changed
ability to capture the bishop that attacks the queen. The gain from
the rook verifier is specific to positional mistake coverage. The
cached worker timings and complete per-dimension counts are in the
receipt. The panel displayed the Lugano case and both lines at
320, 390 and 900 pixels. The installed desktop app is unverified.

**Reproduction.** Use the frozen manifests, references and scores in
`benchmarks/decision-evidence/rook-pressure-mistakes-v46`.
`decision-evidence-rook-sample.py` regenerates the first sample given
the two public PGNs and the earlier exclusion manifests. For the
archived sample compare exclusion digests as a set. The reproduced
ordered case list and search metadata match.
For the
second, use `decision-evidence-tournament.py --mistake-event` with
Misamis Occidental, the validation split and an eight-game limit,
excluding the first sample and earlier positions. Generate the v46
root, reply and shared-reply frames with the existing Stockfish 19
settings. Replay through `decisionMistakeBreadthReplay.test.ts` and
use `decision-evidence-ordinary-replay-score.py --mistakes`. The
`costly-pawn-recovery.patch` applies against v45 using
`git apply --unidiff-zero`. Keep the committed tactical core fixed
for all arms.


## Iteration 47 — compare consequences of opening the king's pawn cover

Four candidates replayed the two weaker and two stronger Stockfish lines.
The first requires a rook or queen check down the file opened by an original
pawn. The second also accepts capture of a second original shield pawn.
The third tests for a tactical diagnosis when a legal exchange forces that
pawn departure and leaves a verified material cost. The fourth compares the
part of the shield involved in the attack and allows the better move to take
the king away from the attacked file. All four reuse the existing searches.

| Evaluation sample | Positional TP / reviewed positives, v46 → strongest candidate | Mixed TP / reviewed positives, v46 → strongest candidate |
| --- | ---: | ---: |
| 226 historical decisions | 10 / 58 → 11 / 58 | 2 / 9 → 2 / 9 |
| Initial 18-game sample, later used for fourth candidate development | 0 / 5 → 1 / 5 | 0 / 1 → 1 / 1 |
| Untouched 18-game reserve | 0 / 8 → 0 / 8 | 0 / 4 → 0 / 4 |

There were zero additional reviewed false positives. No candidate changed
tactical scores, position-character reports, candidate-move reports or
evaluation losses across the 262 decisions. The reserve has six reviewed
negatives for each scope measured here. It is a targeted, small study
labelled by one engine-assisted reviewer. None of the variants transferred
to the reserve, so they remain experiments.

The development gain after `29.Rb1 Bxf4 30.gxf4 Bxh3` concerns White's
own pawns on g3 and h3. Separately targeted searches after the exchange
show `31.Bxh3 Rxf3`, with Stockfish scoring the forced bishop recapture
worse than its unrestricted alternative. That offline search documents
the reply. The candidate still lacked a verified tactical diagnosis in the
worker replay. In the initial sample, `34.Rcg1 Nxe4+ 35.fxe4 Rf8+`
opens the f-file while the better `34.Ng3` lines move the king away
by the matched attack ply. The fourth candidate added positional
support to the existing tactical assessment when the matched
shared reply was included.

Two older mixed-reference explanations failed legal-board review.
The d5 pawn in the World Amateur case is blocked by a black pawn on
d6, so the passed-pawn rationale fails. In the Asian Disabilities Women's
case, Black played `...Qc2` and the subsequent pawn movement damaged
White's shelter. It cannot establish a positional concession by Black.
The frozen reference metrics are preserved. Treating the two disputed
positional axes as uncertain changes the sensitivity denominator from
nine reviewed mixed positives to seven, with two true positives either way.

The reserve also exposed a limitation of comparing pawn counts alone.
After `21.Qe2 Bxh3 22.gxh3 Qg5+`, Black sustains the checks. The stronger
`21.Qf3 Qxf3 22.gxf3` also vacates the g-file but exchanges queens first.
In a separate reserve game after `25...a5 26.e6 fxe6 27.Bxg7`, the early
damage is real, yet Stockfish's separately searched `25...Ne8` branch
also loses the original g7 pawn two plies later. A reliable test must
compare access for the attacking pieces and explain why the different
timing matters. Both positions are now development examples.

The earlier neural ranking experiment measured position character,
a separate question from these mistake diagnoses. On the grouped
259-game replay, the continuation network achieved mixed average
precision of 0.835 and nominated 24 reviewed positives at the fixed
review budget. Logistic ranking on the same continuation inputs
achieved 0.854 and nominated 25. Improving the labels and testing
whether a ranker allocates the same engine budget more effectively
remain measurable next experiments.

**Reproduction.** Use the frozen strata, board positions, labels,
and the four-arm patch under
`benchmarks/decision-evidence/shelter-consequences-v47`.
`decision-evidence-shelter-consequence-sample.py` selects one played
move per game from public classical PGNs. Both candidate decisions
and engine searches are outside its sampling inputs. Generate the
Stockfish 19 root cache with depth 18 and a maximum of 9.6 million
root nodes. Generate reply frames with `--capture-resources
--position-choices`, then generate `tournament-shared-v47` with
`decision-evidence-shared-reply.py`. Use the existing
`decisionMistakeBreadthReplay.test.ts` and
`decision-evidence-ordinary-replay-score.py --mistakes`.
Apply the patch to v46 with `git apply --unidiff-zero` in an
isolated checkout. Set the final argument of
`compareShelterConsequence` to `"file-check"`, `"cover-capture"`,
`"exchange-cost"` or `"distinct-cover"` before each replay.
The two small case-level evidence receipts preserve the disputed
boards and the additional Brazilian counterfactual search.


## Iteration 48 — rank unresolved played mistakes with learned models

The previous neural benchmark ranked position character. This pilot ranks
unresolved diagnoses of actual played moves. It uses the same regularized
logistic regression, shallow boosted trees and three-seed neural ensemble
from iteration 41. Its continuation features preserve the identities of
the played and best moves and describe their first 12 legal plies. The
models see Stockfish evaluations and features computed from the boards
along the lines. The incumbent diagnosis only defines which cases are
unresolved. Separate tactical and positional heads contribute to the
mixed rank. The minimum of those scores is a rank and has no joint
probability interpretation.

Train on the 226 historical decisions and group all sections of a
tournament in the same development fold. The two 18-game transfer
samples come from different tournament families. They were already
used in the king-cover experiment, so this is an exploratory transfer
test. The learning settings were inherited from iteration 41. Scoring
excludes uncertain labels from average precision. They still consume a
review slot when nominated. The transfer comparison gives each model
four review slots per dimension and per sample.

| Reserve measure | Logistic on continuations | Neural on continuations | Boosted trees |
| --- | ---: | ---: | ---: |
| Tactical positives in four nominations | 4 | 4 | 3 |
| Positional positives in four nominations | 3 | 3 | 3 |
| Mixed positives in four nominations, original labels | 3 | 2 | 1 |
| Mixed positives in four nominations, audited training labels | 3 | 3 | 1 |
| Mixed average precision, audited training labels | 0.875 | 0.950 | 1.000 |

The reserve contains seven reviewed tactical positives, eight positional
positives and four mixed positives. The incumbent already found three of
the tactical positives and neither of the other types. On the initial
18-game sample, logistic and neural continuation rankings both nominated
one mixed positive of four and two positional positives of four. The
evaluation-only logistic baseline nominated three positional positives
in its four slots there. The neural continuation model's better reserve
mixed ranking did not yield more reviewed positives at the fixed budget.
Removing the two disputed training labels improved its nomination count
by one. Neither changing the network size nor calibrating on these two
samples would resolve that uncertainty. A useful follow-up measure is
added Stockfish-verified diagnoses at equal search cost on new,
unexposed tournaments.

**Reproduction.** Run `decision-evidence-mistake-model.py` against
`decision-evidence-line-model.py` using the three v46 incumbent worker
replays as training and the two v47 incumbent replays as transfer.
Use the same group samples and engine settings from iterations 46 and
47. Repeat with the two exact case IDs from the v47 reference audit
passed to `--uncertain-positional`. The resulting models nominate
possible diagnoses for follow-up. They do not add reports or run extra
engine searches. The aggregate results and fit settings are in
`benchmarks/decision-evidence/mistake-model-v48`.


## Iteration 49 — measure verified diagnoses at equal Stockfish cost

The experiment froze 48 decisions from 24 games across Cascade Open,
Fall NYC Chess Norms, Tournament of Peace and Benidorm Group A. Each game
contributes one annotated loss and one annotated control. Each of the
four tournament sources is independent of the v48 model training data.
The public PGNs give classical controls. One reviewer read paired and
separately searched legal lines before opening app reports or model
nominations. Ambiguous axes remain uncertain.

Twenty-two decisions met the search eligibility conditions. Each of five
policies nominated six games for an extra six million nodes after the
played move and six million nodes after the best move. Both use the same
Stockfish 19 build with one thread, a 64 MiB hash and up to three replies.
Original paired root evaluations were held fixed. The same app worker
reassessed the mistake using the deeper replies. Twelve distinct
decisions covered all five nominations. Each policy cost 72 million
requested nodes.

| Policy | Added tactical positives | Added positional positives | Added mixed positives | Added reviewed false positives |
| --- | ---: | ---: | ---: | ---: |
| Continuation logistic | 0 | 0 | 0 | 0 |
| Continuation network | 1 | 0 | 0 | 0 |
| Evaluation-only logistic | 1 | 0 | 0 | 0 |
| Largest Stockfish loss | 1 | 0 | 0 | 0 |
| Seeded control | 1 | 0 | 0 | 0 |

The original worker found 2 of 12 reviewed tactical positives, 1 of 14
positional positives and 0 of 4 mixed positives. The four successful
policies all found the same new case. In Fall NYC Chess Norms,
`39...Qe6 40.Rf6 Bxf6 41.Qd3+` inserts a queen check before
`42.Rxf6`. Both original searches show the check, and the longer
separate search gives a comparable 12-ply material consequence.
The exact lines and the engine score, depth and node counts are saved
in the case receipt. The original recorded loss is 4.56 pawns.

An exploratory exhaustive run searched the ten eligible choices that
none of the five policies nominated. Across all 22 and 264 million
requested nodes, the worker still added just one tactical diagnosis.
The two deeper branches took a median of about 9.8 combined seconds
on this machine during the concurrent experiments. The immediate
opportunity is better evidence extraction from the existing legal lines.

The Benidorm counterfactual records a separate remaining mechanism.
After the same legal sequence following either knight capture on d5,
White's `Ng6+` is met by `Nxg6` only when Black's original e7 knight
stays on e7. The forced replies and both legal boards are in the
receipt. The app still needs to establish when that kind of alternative
changes a tactic's outcome across the searched choices.

**Reproduction.** Use the sample, reference, protocol and source list in
`benchmarks/decision-evidence/mistake-search-budget-v49`. Generate
root and reply frames using the v47 parameters and `v49` cache suffix.
Replay the full sample with `decisionMistakeBreadthReplay.test.ts`.
Run `decision-evidence-mistake-search-budget.py nominate` with the same
three historical worker reports and disputed training IDs as v48.
Its `search` command outputs an extra-reply manifest for the app worker.
Replay that manifest, then use the `score` command to assemble the
five equal-budget outcomes. Keep the committed tactical core fixed
through the replays. The exhaustive complement is a separate diagnostic
based on the eligible games outside the nomination union.


## Iteration 50 — verify a check inserted before recapture

The NYC replay suggests a lower-cost follow-up. In both weaker branches
the White rook goes to f6 and Black captures it with the bishop. White
can legally recapture immediately and instead gives `Qd3+` first.
White recaptures on f6 after either king reply. The same `Rf6 Bxf6`
exchange is legal after the better `...Kg8`, where `Qd3` gives no check.
A separately searched `Rf6` reply after `...Kg8` scores −7.74 for
White, compared with +4.84 for White after `...Qe6` in the separate
original reply search. The control establishes that the same exchange
has sharply different outcomes. The legal replay shows exactly which
checking tempo the king move removes.

The candidate reuses the current app's allocation for one shared
opponent reply. It needs the exact early exchange and delayed recapture
in both weaker branches, the absent check in the alternative replay,
and a coherent Stockfish score for the forced control. The NYC case
takes one targeted one-million-node query in the normal workflow
when that reply is missing from the cached branches. The v49 approach
spent 12 million nodes extending both replies. The forced comparison
also identifies the check that the alternative avoids.

The candidate recovered this one tactical diagnosis on the 48
development replays and changed none of the earlier 226 reports.
The Formentera recorded control produced no diagnosis in either
version. A fresh preview across 190 annotated decisions from the
Formentera and Abu Dhabi tournaments found no qualifying variations,
first at 60,000 nodes and then at one million nodes. Aeroflot round 3
had no eligible evaluation annotations for the preview. The model
and rule experiments establish limited coverage for this search
pattern. The rule remains a replayable prototype while independent
positive evidence is pending.

**Reproduction.** Use the exact NYC frames in
`benchmarks/decision-evidence/mistake-search-budget-v49/nyc-intermezzo.json`.
Apply `checking-recapture.patch` with `git apply --unidiff-zero`
against the recorded revision in
`benchmarks/decision-evidence/checking-recapture-v50/summary.json`.
The patch includes a positive replay and checks for an incomplete
continuation, an inadequate score contrast, a missing control and a
check that applies after both choices. The public-game preview uses
`decision-evidence-intermezzo-preview.py` and the source list in
`preview-scan.json`.


## Iteration 51 — compare pawn structure after recaptures settle

The previous worker could recognize a structural benefit caused by
some root moves. It had much less coverage for a positional cost that
appeared in the subsequent exchanges. The new comparison follows the
same original pawn across an actual played move, a stronger move and
independent reply searches for both choices. It works with the existing
engine frames.

A pawn capture in the first five plies can nominate a new isolated or
doubled pawn. Both played continuations must repeat the capture. The
structure must persist across at least four plies and the pawn must
remain blocked from passed-pawn status by an opposing pawn. Both
stronger continuations must retain the original pawn and avoid the
same structural weakness. The worker allows a bounded wait for
exchanges to settle before comparing material at the same ply. It
shows the evidence as a board fact supporting a strategic
interpretation.

Four experimental arms independently varied which recaptures were
eligible and whether the material comparison could wait for a later
ply. Both fixed-window arms missed the Halloween case. After
`24.Qg4 Qxg4 25.hxg4`, the doubled g-pawns survive a further exchange
on b5. Looking one ply beyond the recapture on b5 confirms the same
structure at comparable material. This example informed the settlement
variants. The Arco case came from the untouched reserve.
`17...h4 18.Bxc6 bxc6` leaves the black c6 pawn isolated.
`17...Ne5` leaves the b7 pawn connected and allows a different
minor-piece exchange. The broad arms find the latter example, which
comes from a recapture away from the square of the played move.

| Sample | Reviewed positive positional cases | Incumbent | Linked fixed | Broad fixed | Linked settled | Broad settled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 274 development decisions | 72 | 11 | 12 | 13 | 14 | 16 |
| Initial 24-game sample | 7 | 0 | 0 | 0 | 1 | 1 |
| Untouched 20-game reserve | 10 | 2 | 2 | 3 | 2 | 3 |

No variant adds a reviewed positional false positive, and all
previously detected positives survive. The reserve contains five
reviewed positional negatives and five uncertain positional references.
The initial 24 games were unseen for the fixed-window variants and
informed the later settlement comparison. All labels were frozen
before opening classifier output for the respective experiment. The
new samples are enriched for structural changes and use one
engine-assisted reviewer. They measure the evidence rule on this
class of mistakes.

The app uses the broader settled variant and shows both lines under
Show evidence. The 318-decision release replay matches that variant
and retains the same tactical verdicts, candidate-move reports,
position-character reports and paired evaluation losses. It performs
no extra Stockfish searches. Confirmed mixed coverage on these samples
remains limited. In Benidorm, the existing tactical assessment gains
a positional explanation for the damage from `...Nh6 Bxh6 gxh6`.
Its historical mixed reference is uncertain and it does not count as
a verified mixed gain.

The TypeScript check and 33 focused tests pass. The source-built
panel shows the Arco and Halloween cases with their legal lines at
320, 390 and 900 pixels using the stored Stockfish searches. The
installed desktop app is unverified.

**Reproduction.** Sample the public tournaments with
`decision-evidence-structure-mistake-sample.py`. The sources,
case selections, frozen reference labels and exact results are under
`benchmarks/decision-evidence/pawn-structure-mistakes-v51`.
Regenerate the v51 root, reply and shared-reply frames at the
v47 engine settings and use `decisionMistakeBreadthReplay.test.ts`.
Apply the experimental patch to the recorded baseline with
`git apply --unidiff-zero` and set the sixth argument of
`comparePawnStructure` to `"linked"`, `"wider"`,
`"linked-settled"` or `"wider-settled"`. Score using
`decision-evidence-ordinary-replay-score.py --mistakes`.

## Neural motif transfer and fork localization

The earlier neural rankers learned on a few hundred played decisions.
This experiment trained on a separate, larger source with a more
specific objective. It streams 13,680 tagged Lichess puzzles, with
10,800 for training and 1,440 each for validation and test. The
sampler keeps one puzzle per source game, rejects duplicate boards
including color mirrors, and excludes the existing transfer samples.
It stratifies on 11 tactical motifs and a background group. The
resulting theme frequencies describe this sample. Lichess tags cover
the solution and their absence is only a weak negative for training.
[Lichess puzzle database](https://database.lichess.org/#puzzles)

Each input replays a legal continuation and encodes attacks, defended
squares, the pieces involved, check, pins, discovered rays, material
and the relationship between adjacent plies. The neural model learns
from ten plies. A shared per-ply encoder and a five-ply convolution
combine local features. A differentiable pooling operation fits the
tags on the whole solution without assigning them to a move. The
linear and dense controls use the same line features. The first-ply
linear control sees only the first move and no reply features.

| Method | Mean average precision across 11 held-out source tags |
| --- | ---: |
| First-ply logistic regression | .459 |
| Full-line logistic regression | .796 |
| Full-line dense neural network | .853 |
| Temporal neural network | .888 |

The temporal ensemble is three fits of 12,475 parameters. Warm CPU
inference averaged 0.59 ms per position after feature extraction.
Feature extraction averaged 0.41 ms on the 40-position audit. These
timings exclude Stockfish, start-up, and app integration.

### Transfer to reviewed moves

The score-only transfer uses 44 independent puzzle moves and
34 Woodpecker moves with selective reviewed motif labels. The exact
move is kept in each Stockfish frame. The broad sequence model
nominated two of four originally annotated missed forks in ten
review slots. Rechecking the stronger replies corrected an old
reference. In `...Nd2+` the targets are Kf1 and the pawn on f3. The
queen on e1 can capture the knight and is outside its attack. The
reviewed target at e1 was wrong. The model finds one of the three
remaining positives and nine explicit negatives at ten slots.
`...Bd4` really does attack Qe5 and Ra1. Three separate Stockfish
queen retreats allow `...Bxa1`. In another nomination, `...Rxb3`
prepares the real fork `...Nb4+`, which belongs to a later move.

The new audit contains 40 unused puzzle games, including moves with
credible root fork geometry and moves whose genuine fork comes
later. A single reviewer read the exact board and Stockfish
variations before opening the new predictions. The audit asks for
a meaningful fork on two non-pawn targets, with the king counting
as a target. It excludes incidental mate geometry. Three cases are
uncertain. The current live verifier reported nine of 14 reviewed
forks with zero false positives across 23 reviewed negatives.

| Nominations among cases the live verifier left unresolved | Reviewed forks | Reviewed negatives | Uncertain |
| --- | ---: | ---: | ---: |
| Geometry plus collection in the engine line | 5 | 4 | 3 |
| Temporal neural network | 2 | 10 | 0 |
| Temporal model's first-ply score | 1 | 8 | 3 |
| Geometry plus the temporal first-ply score | 5 | 4 | 3 |

Each row uses the same twelve review slots. These are nominations
and reviewed labels, before any proposed automatic proof. The
network's first-ply score still reflects a nearby sequence and
weak line-level supervision. It offers no demonstrated improvement
in this exact-move task. The curated sample and one reviewer limit
claims about prevalence or game-wide precision.

### Transfer to played mistakes

The played-move triage compares the missed best move, the opponent's
reply to the recorded move, and the reply to the better move. The
separate branches keep a missed opportunity distinct from an allowed
tactic. The score-only benchmark uses 199 historical decisions and
20 newer decisions with both reply frames. Ranked by Stockfish loss,
reviewers find 30 historical tactical mistakes in 49 unresolved
review slots and three newer mistakes in five. Whole-line temporal
ranking finds 21 and zero at the same budgets. It nominates six versus
five historical mixed mistakes, then zero versus two on the newer
sample. These are review yields. The setup contains no learned
positional head and adds no verified app diagnoses.

This experiment stays offline. Whole-solution tags support training
a motif ranker. A model for app explanations needs labels tied to the
exact first move or refutation, a genuine nearby negative, and a legal
payoff or defensive branch. The current verifier and simple search
controls set the baseline for that test.

**Reproduction.** See `benchmarks/decision-evidence/neural-motif-transfer`
for the source ETag, split hashes, exact public reference, amendment,
engine receipt and detailed results. Run
`decision-evidence-motif-corpus.py` with the independent, course,
classical and two checking-tempo sample manifests excluded. Use
`decision-evidence-fork-audit-sample.py` with the frozen corpus and
the original transfer input. Give the published `fork-engine-input.json`
to `decision-evidence-engine.py --split validation --minimum-depth 18
--maximum-root-nodes 2400000` for the 40 cases and two witness positions. Use the published fork reference
and amendment with `decision-evidence-motif-transfer-inputs.py`.
The exercise inputs use the v13 holdout sources and the original
worker replays supply the played decisions. Set
`DECISION_MOTIF_TRANSFER_INPUT` and `DECISION_MOTIF_TRANSFER_OUTPUT`
for `decisionMotifTransferReplay.test.ts` on the recorded baseline.
Then run `decision-evidence-motif-sequence.py` and
`decision-evidence-motif-transfer-score.py`. Python 3.13,
python-chess 1.999, PyTorch 2.10.0 CPU, NumPy 2.5.5 and
scikit-learn 1.9.1 were used. The private course inputs, training
sample, weights and feature cache stay outside Git.

## Exact-move fork supervision and classical transfer

The follow-up trains on one exact geometry candidate per puzzle
game and, where available, a different legal double attack from the
same board. The sampler prefers an alternative of the same piece
type with matching check and capture status. The game and
color-normalized position stay in one partition. Training sees
the first two complete Stockfish replies from a 6,000-node search.
Labels come from a separate 120,000-node search with cleared hash.

The supervised target is a narrow payoff. A piece creates two
non-pawn threats and takes an original stationary target by the
fifth ply. The two strongest searched defences must retain material
in the bounded replay. The evaluation must also support the
attacker. A clear countercapture, forced mate against the attacker,
or a terminal root can supply a negative. Other candidates remain
unknown. This definition can miss forks that save draws, whose
benefit lies in an exchange, or whose payoff arrives later. It is
an engine-derived training target with a separate human review.

| Equal-budget ranking | Held-out puzzle payoffs in 106 slots | Missed reviewed classical forks in 20 slots | Reviewed classical negatives in those slots |
| --- | ---: | ---: | ---: |
| Shallow legal payoff cue | 70 | 2 | 5 |
| Shallow Stockfish evaluation | 34 | 3 | 6 |
| Root-only logistic regression | 51 | 2 | 12 |
| Two-reply logistic regression | 70 | 3 | 6 |
| Shared-branch neural network | 67 | 2 | 10 |

The 424-candidate puzzle test has 76 teacher positives, 185
negatives and 163 uncertain cases. Both reply models reach AP 1.0
on the known teacher labels and correctly order all 42 same-game
pairs with opposite labels. The untrained payoff cue also orders
all 42. This indicates considerable agreement between shallow
features and the deeper training definition. It gives limited
evidence for learning exact tactical concepts.

The classical transfer consists of 64 played moves from three
public tournaments plus 24 moves from the owner's classical
games. Each move is taken from a different game. One reviewer read
the board and independently searched replies before opening the
predictions. There are seven positive, 60 negative and 21 uncertain
reviews. The live motif replay finds four positives and no
reviewed false alarms, leaving three reviewed positives in the
unresolved set. The neural model finds two of these in 20 slots
against three for each of the stronger simple rankers. Among
known cases, its unresolved average precision is .442, against
.556 for the two-reply regression and .833 for shallow evaluation.
The three independently seeded neural fits have 14,029 parameters
each. The measured result keeps this route offline.

### Two verified analysis paths

Decision Evidence replays the legal responses separately, raising
exact-fork recognition from four to five of seven here. One of the
owner's missed badges, `...Ne5`, already has a root fork witness
in Decision Evidence. Different replies allow `...Nxf3+` or
`...Nxc6`. `Bc6` still lacks an explanation. Its principal reply
can delay `Bxd7` by a full move, and the second useful defensive
line collected the target at a different ply. A promotion fork
also remains without the precise fork label, although the app
shows the promotion.

A test-only two-reply proof tried following the actual fork piece
to a later collection, and verifying the price of disarming a
promotion where a target takes the promoted piece. Both replies
must belong to the exact move. Screens check a legal new attack,
distinct replies and retained material. Existing and candidate
results use identical reply searches. A separate 30-game
Hvar, Stockholm and Halloween reserve has six reviewed positives,
19 negatives and five uncertain cases. The reply proof adds zero
on development and reserve. The deeper comparison requested
97.2 million additional offline nodes across both samples.

Decision Evidence records five of six reserve positives. It also
uses two additional conditional forks noticed only against weaker
defences. In both, the best reply takes the fork piece without
conceding the threatened material. The alternative lines are
genuine conditional evidence. Promoting them to a supported move
verdict for this benchmark overstates the role of the fork.
Preserve conditional continuations while measuring their role in
the main decision independently. The replay keeps any pawn-only
fork witness outside the two-non-pawn-target audit.

**Reproduction.** The protocol, the public samples/references and
the comparative scores are under
`benchmarks/decision-evidence/exact-fork-supervision`. Run
`decision-evidence-fork-payoff.py --nominate` on the frozen
November puzzle sample. Select classical inputs with
`decision-evidence-fork-classical-sample.py`. Generate the exact
paired Stockfish 19 frames with `decision-evidence-engine.py` at
minimum depth 18 and maximum root budget 2.4M. Use
`decision-evidence-fork-replies.py` to fill reply frames at depth
16 where possible. The test `decisionExactForkAudit.test.ts` takes
`DECISION_EXACT_FORK_INPUT` and `DECISION_EXACT_FORK_OUTPUT`.
Run `decision-evidence-fork-payoff-audit.py` on those outputs, and
`decision-evidence-fork-payoff-model.py` for the equal-budget
comparison. The model's incumbent input maps case IDs to whether
the live replay supplied a root fork badge. The private records,
weights and engine caches stay
outside Git.

## Conditional forks and their consequences

A quiet fork can be real in one reply and be neutralized in the
main line. The old Decision Evidence report added the conditional
witness to the main mechanisms and promoted it to a supported
tactical reason. In Hvar, `...exd4 Bf2 ...dxc3` and
`Nxb6 ...Nc3 Nxa8` are legal, meaningful alternative lines. The
strongest replies `Bxd4` and `...Nxb6` remove the forker without
paying for the threatened material.

Decision Evidence now records the weaker fork and the best reply
together under Show evidence. The weaker line remains available
for practice. It contributes a tactical justification to the
verdict when the independently checked best defence has a linked
consequence. The current proof covers a recapture that retains an
exchange gain in both searches and the independently corroborated
rook-file access created by a pawn recapture. Both searches must
show the same exchange. A pawn captured before the fork defence
cannot count again as a cost of answering it. Other material and
positional evidence continues to enter the assessment independently.

The synthetic `Qb4 Qxb4 cxb4` fixture stays mixed. The queen
threatens both pieces, and answering with the queen exchange lets
the c-pawn vacate the file for the rook. The best reply in each
Hvar case now appears alongside its weaker alternative. Neither
weaker fork determines the move verdict.

The public test froze a 24-position reserve drawn from eight
classical tournaments. A cheap Stockfish preview selected likely
fork alternatives without using either classifier. The subsequent
review read the exact root and separately searched legal reply
frames before opening any predictions. Results refer to the
fork's contribution to the played move, within this targeted sample.

| Replayed sample | Previously supported reviewed forks | Revised supported reviewed forks | Previously overclaimed | Revised overclaims |
| --- | ---: | ---: | ---: | ---: |
| Fresh 24-position reserve | 3 / 4 | 3 / 4 | 10 / 17 | 0 / 17 |
| Earlier 30-position reserve | 5 / 6 | 5 / 6 | 2 / 19 | 0 / 19 |
| Earlier 88 played moves | 5 / 7 | 5 / 7 | 0 / 60 | 0 / 60 |

All ten demoted fresh-reserve forks remain available under
evidence with the same legal alternatives. The evaluations and
search inputs match for both systems. Three fresh reference cases
were uncertain. An unclassified `...Rc2` remains a mixed
challenge involving a rook offer and the recapture `...bxc2`.
The present proof covers neither that passed-pawn compensation
nor all the ways a secondary threat can influence a defence.

Across the 259 ordinary source replays, all report content matches
apart from the version. Across 318 mistake replays, two position
and move summaries lose support from a neutralized fork. Their
mistake diagnoses and all other mistake reports match. The extra
search selections match and this feature requests no engine work.
The changes pass focused regressions. The source-built panel opens
both lines with keyboard and mouse at widths of 320, 390 and 900
pixels, and the examples display the expected distinct verdicts.
Installed app verification is pending.

**Reproduction.** See `benchmarks/decision-evidence/conditional-fork-consequences`
for the public reserve, reviewed references, parameters and
before/after results. Use `decision-evidence-conditional-fork-sample.py`
with the recorded event archives and exclusion manifests. Search
both arms on the same paired root and defence frames using
`decision-evidence-engine.py` and
`decision-evidence-fork-replies.py`. Run
`decisionExactForkAudit.test.ts` followed by
`decision-evidence-fork-payoff-audit.py`. Ordinary and mistake
library replays use the existing release manifests.
