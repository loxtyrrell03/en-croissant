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
