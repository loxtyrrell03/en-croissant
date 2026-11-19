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

## Remaining acceptance work

Expand and adjudicate the reference data across all requested decision types and
motifs, including actual owner mistakes and fresh independent source games.
Build and compare engine-guided motif and positional-dependency candidates,
with mixed/uncertain evidence and adaptive cached search. Freeze the winning
candidate before opening validation. Integrate the full pipeline and UI,
verify real workflows and deliver only after the completion evidence above is
satisfied. The rebuild remains active.
