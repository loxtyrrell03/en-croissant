# Tactical relevance judgement, 2026-09-08

## Live pipeline 41: cold worker startup is not proof computation

The isolated development HTTP check reproduced a false timeout: Vite loading
and transforming the worker graph took 6-15 seconds before the classifier ran.
The desktop had charged that startup against its three-second computation
deadline. The worker now announces when it begins processing the input. Its
owner allows at most 20 seconds to start, then keeps the existing three-second
proof deadline. Repeated start messages cannot extend it; cancellation ends
either phase and late messages cannot change the board/cache. Missing startup,
crashes, malformed messages and success without the handshake remain failures,
never empty successful scans or UI-thread fallback.

The panel says **Loading tactical verifier** before **Verifying tactical themes**;
the native engine is already released during both. Eleven added lifecycle/UI
regressions pass within 423 selected tests (two opt-in skips). The actual
application controller is now exercised by both HTTP and production-worker
tests, with only browser transport adapted to Node. Force-cold isolated Vite
checks took 5,705/9,286 ms to start and 7/117 ms to classify/transfer the Reti/f7
cases; both pass the actual controller. All 82 cold production cases match
source: total median 83 ms/p95 292 ms/max 657 ms; startup max 46 ms, computation
max 626 ms. See `dev-worker-latency.json` and `worker-latency.json`. This removes
a false failure; it is not a claim to have accelerated cold development imports.

Reproduce without an active app using
`node scripts/tests/run-tactical-dev-worker.mjs`. It owns an HTTP-only Vite
instance on an OS-selected port, a separate dependency cache and closes that
server in `finally`; it never launches/restarts the desktop. Set
`TACTICAL_DEV_COLD=1` to force its dependency re-optimization and
`TACTICAL_DEV_WORKER_REPORT` to record timings. Production build (8,860 modules)
and targeted lint pass; TypeScript retains the unrelated OTB fixture error.
Classifier adapter 39 and chess decisions are unchanged. No native package,
phone service or website was deployed, and no WebView/CSP/physical UI proof is
claimed. The broader quiet/long-combination limits remain documented below.

## Adapter 39: joint discoveries versus subordinate traps

The reached position after the adjacent sample's `Bb3 Kh8` exposed a wrong
primary lesson: Nxc7's verified 600 cp immediate discovered attack on Qf7/Ra8
was secondary to a 270 cp trapped-rook consequence. A strictly larger,
independently verified discovery now subsumes a trap only on the same actual
target at the same ply. Equal gains and unrelated targets retain their lessons.
The explanation names both the revealed bishop/queen ray and the knight/rook
attack, and the board shows both. Incidental pawn pressure is not appended.
Missed-opportunity review uses the same primary, not a separate taxonomy rank.

Five fresh depth-16 searches in `discovery-priority-stockfish-18.json` distinguish
Bb3 (+135 cp) from premature Nxc7 (-372 cp); after Bb3/Kh8, Nxc7 is the unrestricted
best move (+175), and restricted Nxc7 (+149) beats Nxf8 (+3). Those full-position
scores are not the local proof values. The losing premature move is rejected
as a live alternative. Bb3's own quiet preparation remains unproved by the
classifier and is not counted as a solved headline. The original 81 worker
main labels and 32-case mistake-priority report are unchanged; worker parity
now also includes this reached position (82 cases, 80 ms median/266 ms p95/
687 ms maximum, excluding engine/UI). Nine new regressions, targeted lint,
shared review-worker and 8,860-module production builds pass. TypeScript retains
the unrelated OTB fixture error. An isolated cold development HTTP test exposed
6-15 second import/transform startup, which exceeds the current three-second
worker deadline; the pipeline-41 milestone above repairs that lifecycle issue.
No app restart/deployment or physical UI verification is claimed.

## Adapter 38: costlier existing checking discoveries

The adjacent audit's Ng5 case now distinguishes an existing discovery from
making it more expensive. Both Nd4/Bg5+ and Ng5/Bxg5+ uncover the same rook
against the queen; completed all-defence immediate exchanges establish 570
versus 890 cp. Review says **More costly**, with the legal hxg5 defence, not
that Ng5 created a new attack. Identical participants, complete exchange
leaves and non-capturing user choices are required; lower bounds do not prove
severity. Four fresh engine searches confirm the direction but a different
full-position difference (121 cp), which is kept separate from local material.
See [the adjacent review](ordinary-adjacent-review.md) and
`discovery-severity-stockfish-18.json` for proof scope and reproduction.
Nine new regressions pass within 403 selected tests (two opt-in skips), along
with all 32 fresh before/after judgements, 81 built-worker parity cases,
development HTTP worker execution, targeted lint and both production builds
(8,860 app modules). The earlier 32-case lesson report is unchanged; the known
OTB fixture type error remains. No physical UI or deployment claim is made.

## Adapter 37: adjacent ordinary-game audit and profitable recaptures

The [adjacent audit](ordinary-adjacent-review.md) documents all 24 newly sampled
positions, 48 fresh depth-16 searches, the missing Qxd5+ queen-for-bishop payoff,
and remaining long/quiet-attack misses. The fixed stride is disjoint from the
earlier sample but uses the same three games, so it is not an independent
holdout or a general accuracy estimate. Winning recaptures now retain their
net local material value and trade context; routine compensated exchanges stay
suppressed. The original engine/output audit remains frozen and current replay
results are separate. Verification: 393 selected tests (three opt-in skips),
81 cold built-worker parity cases, development HTTP worker execution, targeted
lint, shared review-worker and 8,859-module production builds. The unrelated
OTB number/bigint fixture type error remains. No physical UI or deployment
claim is made.

## Adapter 36: checking clearance, causal king defence and bounded payoffs

The real Qxd4/Bh7+ case now has a constructive comparison, rather than an
accusation based only on the opponent's post-move PV. Before the mistake:
`2rr2k1/1p3pp1/1q2p3/p2pP1N1/1n1P4/1Q1B4/1P3P1P/5RK1 b - - 0 21`.
Qxd4 permits Bh7+, clearing d3 for Qf3 after Kf8 or Qh3 after Kh8.
Choosing Kf8 first makes Bh7 non-checking and allows Ke7 before those queen
routes are used. A separate bounded defence search checks every newly opened
non-capturing slider route, every immediate attacking capture and up to four
checks, requiring actual legal defensive replies. A surviving check at the
frontier, unknown exchange, exhausted 32,768-move budget, captured root or
missing slider route cannot certify prevention. Longer quiet preparations
remain outside this local comparison. No failed attacking proof is treated
as a successful defence.

`clearance-cause-stockfish-18.json` records eight fresh depth-16 searches with
Stockfish 18, MultiPV3, Threads1/Hash32. The actual position after Qxd4/Bh7+
scores -596 cp for Black; after Kf8/Bh7 it scores +243 with Ke7. The helper's
five concrete routes/replies after Ke7 were also searched with restricted
roots: Qd3/Na2 +199, Qe3/Na2 +183, Qf3/f5 +169, Qg3/Na2 +185 and Qh3/Na2
+213 cp, all from Black's perspective. Those are safe witnesses, not claims
of optimal replies. Rd7 also has a legal Kf8 defence to Bh7+; f5 instead makes
Bh7 illegal by blocking the bishop's route. The all-defences clearance proof's
100 cp lower bound is not the engine's full-position evaluation or a claim
that every reply loses the entire queen.

Chess review of the actual line exposed two presentation errors. A proved
clearance may include a quiet queen preparation and quiet defence, so the
ordinary two-quiet-ply cutoff hid its later fork. Its actual proved branch now
extends the episode only through its first profitable nominated-target capture,
within the existing four-check/13-ply limit. Both root evidence and timeline
use that boundary: Bxf7+ can no longer borrow Qxf5 from play after Nxd4 already
won the queen. In the fresh line the useful events are Bh7+ clearance (ply 1),
Qh3 preparation (3), Qh7+ fork preparation (9), Nxe6+ fork (11), and Nxd4 (13).
A smaller attack on an already-pinned g7 pawn is omitted at Nxe6+: an independent
fork wins more against different victims. New pins, shared victims and pins
protecting the forker from the pinned piece's recapture remain eligible.

Twenty new regressions cover the causal branches, legally replayed colour
reflection, missing participants, protected f7 capture, budgets, truncation
invariance, delayed/unproved queen preparations and subordinate-pin noise.
The 24-file selection passes 386 tests (two opt-in skips); all 32 fresh
before/after judgements and the eight-search clearance diagnostic pass. The
frozen 32-case lesson report changes only Bh7+'s comparison, and all 57 built
worker main labels remain unchanged. Cold worker parity passes all 57 cases
(104 ms median, 424 ms p95, 724 ms maximum here; excludes engine/WebView/UI).
Targeted lint, shared review-worker and 8,854-module production builds pass;
TypeScript retains the unrelated OTB number/bigint fixture error. Development
HTTP worker tests also pass. This is development evidence, not general tactical
accuracy, arbitrary-combination proof or physical UI verification. No native
package, website, Outpost or running service was deployed/restarted.

Reproduce the engine diagnostic by setting `TACTICAL_JUDGEMENT_ENGINE` to a
local UCI engine and `TACTICAL_CLEARANCE_CAUSE_REPORT` to a report path, then
running `node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t "inspect Bh7 clearance"`.

This evaluates the lesson shown for a position, rather than agreement with a
puzzle's complete tag set. The initial nine positions and expected lessons were chosen before
the first relevance filter; subsequent cases document iterative judgement below. Stockfish 18 searched each position afresh at depth
16, MultiPV 3, one thread, 32 MB hash, with a fresh process per position.

| Position | Previous presentation | Judged main lesson |
| --- | --- | --- |
| Initial position | Clearance at ply 11 in a secondary line | None: development |
| Quiet Italian | None | None: ordinary f7 pressure is insufficient |
| Ruy Lopez before Black's third move | Clearance, intermezzo, undefended piece | None: opening continuations are conditional |
| Rook can capture loose queen on a4 | Hanging piece, mate threat, zugzwang | Hanging queen, Rxa4 |
| Protected knight/bishop attack on f7 | Fork and Weak f7 merged | Nxf7 fork; Bxf7+ is a separate sound alternative |
| Re8 is mate | Back rank, mate distance, mate threat, zugzwang | Back-rank mate; omit alternatives that miss mate |
| Rxd5 Qxd5 Re8+ Rxe8 Qxd5 | Deflection/discovered attack | Deflection: the d8 rook leaves its queen |
| Qh6+ mating attack | Mate mixed with sacrifice/trapped-piece labels from losing alternatives | Mate in two in the engine's Kg8 Qg7# branch |
| Symmetrical king/pawn ending | Zugzwang on all three lines | None: the position is drawn |

An important correction to the initial human judgement: in the Qh6+ position,
Kxh6 is **not** forced. Kxh6 Rh3# is Anastasia's mate, but Kg8 Qg7# is a different
mating pattern. The display must describe the actual continuation, not claim
that one pattern is unavoidable. The deterministic regression retains Kxh6
as a separate legal branch, with attraction as its mechanism and Anastasia's
mate as its payoff.

The recorded JSON contains the FEN, judgement, expected headline, all three
fresh engine candidates (including excluded ones), retained line themes,
both-side ply evidence, and classification time. It is evidence for these positions, not an accuracy
estimate for all chess. Engine timing varies with other work on this PC.

## Immediate causal comparisons and continuation evidence

The second milestone checks each continuation ply in its own legal position,
including the opponent's replies and repeated occurrences of the same motif.
Those rows remain secondary evidence in a conditional engine line; they cannot
replace the main lesson or establish that the entire continuation is forced.
Routine recaptures, global opening/check tags, and incidental pins that do not
explain a winning capture are excluded from these rows.

`causal-stockfish-18.json` records fresh searches before and after ten choices,
with all three engine candidates and the resulting explanations:

| Mistake | Engine's better move | Judged causal lesson |
| --- | --- | --- |
| Black plays b6 in the screenshot position | O-O | Allows Nxf7; castling removes the profitable queen/rook fork |
| White plays Kb1 with a loose black queen and attacked white knight | Nxe4 | Misses winning the queen while saving the knight |
| Black plays b6 facing Re8# | g5 | Allows back-rank mate; g5 supplies Kg7 after Re8+ |
| White plays Ke5 with the queen attacked in the quiet-mate example | Qh2 | The main missed opportunity is forced mate, ahead of the allowed queen loss |
| Black plays h6 with Ne7 pinned to Ke8 | Kd7 | Kxd6 then answers d6; h6 instead permits a pin-based drawing resource |
| Black plays a6 with Kf5 and Qh7 aligned behind Bd3+ | Kf4 | Qxd3 can answer Bd3 once the king no longer blocks the queen |
| Black plays a6 with Nf6 defending Qd5 | Qxd1+ | White must answer check instead of playing gxf6+ and Rxd5 |
| Black plays a6 while Be4 obstructs Re1 against Qe8 | g6 | The pawn interposes on the bishop's route to h7, making Bxh7+ illegal |
| Black plays h6 with the Bb2/Re5 battery facing Qf8/Kh8 | Kg7 | Existing danger: Re8+ wins the queen with a pin, but Rf5+ still wins that same queen after Kg7 |
| Black plays a5 with Ke8 boxed between Rd8/Rf8 | Rg8+ | White must answer check instead of delivering Bb5# double check |

The back-rank-mate position is already materially lost: this judges avoidance of
immediate mate, not a change in the game's theoretical outcome. The initial
human suggestion dxe4 in the queen position was inferior to Nxe4 because it
leaves the knight attacked. A separate deterministic test uses dxe4 to verify
that a capture which persists after both supplied moves is not blamed on the
played move alone. Likewise, h6 is a separately tested escape-square defence,
not the engine's chosen g5.

Causal statements compare the same immediate reply after the actual and best
moves using legality, profitable fork targets, legal exchange analysis, and
checkmate/escape witnesses. They do not transplant the old full refutation
onto a changed position. Deeper differences remain unproven by this check.

Regression fixtures also retain a Black counterfork at ply 2 after White wins
a queen and two separate White forks at plies 1 and 5. Early repeated-fork
fixtures were rejected when a pawn or bishop could capture the knight, or
checking counterplay saved the targets. The pawn-refutation variant remains a
negative test. A server-rendered component test checks the actor and ply rows
and collapsed details; it is not running-app visual proof.

## Quiet mating preparations and adversarial replies

`quiet-stockfish-18.json` records two additional fresh-engine judgements:

| Position | Selected line | Main lesson |
| --- | --- | --- |
| White Kf6/Rg6/Qh5 against Kh8/h7 | Qh3 h6 Qxh6# | Mate threat: either legal pawn push permits mate next turn |
| White Kf6/Qh5 against Kh8/g6/h7 | Qh2 h5 Kxg6 Kg8 Qb8# | Mating preparation: every defence permits mate within two more White moves |

Quiet mate threats are no longer accepted or rejected solely because the root
move lacks a check/capture. A hypothetical pass only identifies a candidate
mate threat. The classifier then verifies **every legal defence** has a legal
mate-in-one answer. For supplied mate-in-three candidates, a bounded tree
checks every defensive reply at both levels and searches legal attacking
answers; the PV only orders candidates, never substitutes for other defences.
The quiet preparation becomes the headline; its final mating pattern stays
secondary. Short mating PVs after checking or capturing roots use the same
all-defences verification.

Eleven deterministic regressions cover both colours, multiple defences, truncated
quiet-mate lines, board labels/arrows, missed-mate priority, persistent mating
danger, stalemate, exhausted proof budgets, queen captures, and checking
counterattacks, and a poisoned pawn capture. In the adversarial cases the supplied PV really ends in mate,
but another legal defence prevents that short forced-mate claim. A bishop's
Bg5+ also refutes the longer cooperative preparation example.

Proofs have 4,096-node (mate next turn) and 16,384-node (mate within three)
caps and bounded caches. An incomplete proof is withheld, not reported as a
proven absence of tactics. The JSON records live-scan classification timing
separately from engine search; timing is diagnostic,
depends on host load/cache state, and is not a UI latency guarantee.

Candidate-search limitation: unrestricted depth-16 MultiPV selected mate in
three in the second position, omitting the faster Qh6. A separately restricted
fresh Stockfish search confirms Qh6 g5 Qg7# as mate in two, and the classifier's
all-defences check agrees. Do not treat the selected engine line as proof that
no faster tactic exists. Local proof strengthens the explanation of supplied
candidates; it is not an exhaustive replacement for root candidate search.

## Material mechanisms, not just a favourable PV endpoint

`material-stockfish-18.json` records eight candidate judgements. Each
has a fresh unrestricted depth-16/MultiPV3 search and a separate search
restricted to the move being judged, so the refutation is engine-selected:

| Candidate | Judged lesson | Observed defence/payoff |
| --- | --- | --- |
| d6 attacks Ne7 pinned by Re1 to Ke8 | Pin, not generic piece pressure | The king moves and dxe7 wins the knight |
| Same d6 with an enemy rook on a6 | No claimed pin win | Rxd6 takes the attacking pawn |
| Bd3+ lines up Kf5 and Qh7 | Skewer | The king moves and Bxh7 takes the queen |
| Same Bd3+ with an enemy pawn on e5 | No claimed skewer win | e4 blocks the bishop's line |
| exf6+ captures the knight defending Qd5 | Removing the Defender | A king reply permits Rxd5 without the knight's recapture |
| Re8+ draws Rd8 away from Qd5 | Deflection | Rxe8 Qxd5 wins queen for rook; the defender's departure changes the legal exchange |
| Same bait with h6 providing Kh7 | No forced deflection | Kh7 declines the bait; unrestricted and restricted searches lead to an approximately drawn exchange sequence |
| Same battery with an additional white rook pinning Rd8 | Back-rank mate | Re8+ Rxe8 Raxe8# is stronger than Qxd5; the already pinned rook was not a legal queen defender |

The king–queen skewer reaches a bishop-versus-king dead draw. It wins material
and avoids the previous disadvantage; it does **not** win the game. Timeline
classification now stops at checkmate, stalemate or dead material, instead of
tagging an arbitrary bishop capture in a later engine shuffle.

The local material proof follows the named targets through every legal
defence and requires a profitable legal capture of those targets, not a loose
piece elsewhere. It includes defensive captures, interpositions, checks,
promotion gains and legal recaptures after an attacking piece is captured.
A protected queen–rook skewer remains valid when Qxd3 loses the queen to cxd3;
the unprotected version is rejected. Defender removal additionally requires
the target's legal exchange to improve after the defender is taken. Merely
removing an already pinned pseudo-defender does not qualify.

Twelve deterministic material regressions cover those examples, promotion
counterplay, the already-pinned defender, an escaping queen, promotion ply
anchoring, and the dead-draw boundary. The initial skewer construction was
discarded because its bishop already checked the non-moving king; the corrected
bishop starts on c4. An initial bishop-capture defender-removal construction
was also rejected: that bishop already pinned the knight, so the knight was
not legally defending the queen. The pawn-capture variant establishes the
actual mechanism, and the pinned variant remains a negative control.

The inherited detector also misattached a later promotion to dxe7 or exf6.
Promotion evidence now requires an actual promotion move and uses that ply;
it cannot survive at a non-promoting capture. Live board relationships now
show both fork targets, or the pin/skewer ray, with the pin label on the pinned
piece. These come from legal board geometry, not parsed prose or a supposedly
mandatory engine reply. Existing preparatory moves are retained for later-ply
motifs. This is source/render-data proof, not physical running-app proof.

## Comparing the cause, including moved targets and checking resources

The adapter now rechecks the same pin, skewer, or defender-removal reply after
the better move. It tracks the same defending pieces across the two choices,
including castling's relocated rook, and looks for a concrete legal answer to
the threatened follow-up capture. It does not transplant the full old PV into
the changed position. Saved headline and timeline evidence retain the same
comparison. Persistent danger alone does not explain the mistake; uncertain
or incomplete exchange proofs do not become claims that the tactic is prevented.

Fresh engine evidence corrected the first pin hypothesis. After h6, d6 saves
White from a roughly three-pawn disadvantage to an approximately equal game;
Black can keep giving checks instead of immediately losing the knight. Hiding
the pin loses the lesson, but calling the capture forced overstates it. The
classifier distinguishes a fully proved immediate gain from a specific pin or
skewer threat for which every **non-checking** reply concedes material. The latter
is admitted only at the engine-evaluated root, with a side-to-move score of at
least -30 cp (a small near-equality tolerance), medium confidence, and explicit
wording that checking replies remain. It is not admitted into unevaluated
later ply rows or losing/scoreless root scans. This is engine-supported threat
evidence, not an exhaustive proof against long checking sequences.

An immediate mating check, a material-winning checking capture/promotion,
or a non-checking defence does not qualify as a harmless checking tempo.
Eight comparison regressions cover an unpinned knight's escape, persistent
pins, a relocated queen, defender-removal follow-up versus the already captured
knight, forcing checks, castling's rook, conditional versus guaranteed pin
evidence, and a quiet mating countercheck despite an optimistic supplied score.
The real engine comparison prefers Kd7 and finds Kxd6; the deterministic Kf8
case checks a different valid unpinning resource. The two supplied pawn moves
in the persistent-pin control are not claimed to be the engine's best moves.

## Discovered combinations: actual cause, not an endpoint label

`discovered-stockfish-18.json` adds six candidate judgements. Each records both
an unrestricted fresh depth-16/MultiPV3 scan (including its displayed primary
lesson and continuation rows) and a separately searched candidate:

| Candidate | Judged lesson | Important evidence |
| --- | --- | --- |
| Bxh7+ uncovers Re1 against Qe8 | Discovered attack | Kf8 allows Rxe8+ Kxe8; Kxh7 also concedes more than the bishop |
| Bf3 opens the same file without check | No tactic for this move | Qxe1# refutes it; the unrestricted scan must still recommend Bxh7+ |
| Rf5+ uncovers Bb2 against Kh8 and attacks Qf8 | Discovered check at ply 1 | Rxf8+ is the payoff, not a second discovered check; unrestricted Stockfish prefers Rg5+, the same primary mechanism |
| Rf5+ with a black pawn on f7 | Discovered check with a forcing continuation | f6 Rxf6 Qxf6 Bxf6 wins queen and pawn for rook; Kg8 instead permits Rg5+ and a losing queen block |
| Rf5+ with an enemy rook on h6 instead of Qf8 | No material combination for this move | Neither battery piece attacks Rh6; the unrestricted scan correctly prefers the available Re8# double check |
| Bb5# uncovers Re1 against Ke8 | Double check | The bishop and rook both check; redundant discovered-attack/check labels are removed |

The f7-pawn example was initially proposed as a negative control. Fresh engine
analysis disproved that judgement: the forced pawn interposition actually opens
the rook-bishop battery. Verifying only its selected f6 reply would still be
insufficient, because Kg8 requires a different answer. A bounded AND/OR proof
checks every legal defence and searches a maximum of one extra checking move
before the named material capture, with legal exchange settlement. Targets are
the revealed ray, the moving piece's threats, their rear ray targets, and actual
checking-line interpositions, not arbitrary loose pieces elsewhere. Defensive
captures and promotion gains count against the claimed net gain. The extra
search has a 4,096-node cap and bounded cache; incomplete proof is withheld.

Discovery labels now require an unchanged bishop, rook or queen whose ray was
actually blocked by the moving piece. Immediate or verified short mate, or a
proved material continuation, must explain the move. An unrelated profitable
PV endpoint is no longer enough. The correct label is reconstructed at the
vacating move: discovered attack, discovered check, or double check, rather than
three aliases at one ply or a check label transplanted onto the final capture.
Explanations name the vacated square, battery piece and target; board arrows
show the uncovered ray and the accompanying attack. An incidental discovery
does not outrank a capture which already wins as much without the follow-up.

Ten deterministic regressions cover both colours, short engine snapshots,
primary mistake-review lessons, root/continuation ply consistency, both relevant
arrows, interposition versus king-escape branches, no-gain checks, a defended
rook that does not justify losing the bishop, a cooperative losing PV, and an
exhausted proof budget. This is source and render-data verification, not a
running-app visual claim. The six scenarios are not six independently sampled
positions: two intentionally compare different moves in the same position.

## A different reply can preserve the same tactical loss

Comparing only the identical reply can create a false causal explanation.
Fresh Stockfish analysis of the Bb2/Re5 versus Qf8/Kh8 position found best
Kg7 at -646 cp and h6 at -713 cp from Black's perspective. After h6, Re8+
pins the queen; after Kg7, the same Re8+ can be answered by Qf6. That initially
made the classifier say the better move prevented the queen loss. But the
engine's actual reply after Kg7 is **Rf5+**, a discovered check which still
wins the same queen for a rook. The 67 cp difference is not explained by
creating that already-forced material loss, and may not meet a review card's
mistake threshold at all. This is an attribution control, not a new tactical
blunder example.

The adapter now checks the opponent's first move in the better move's own
legal engine continuation. Locally proved material signatures match the same
target pieces across the two choices, including relocated pieces, without
requiring the same capturing piece, reply or theme. The alternative must prove
at least the actual net gain, including legal recaptures and any larger observed
gain at the actual named-target capture. A lower bound alone is not evidence
that a larger loss is equivalent. Matching raw centipawn evaluations, equal
piece values on different targets, an illegal line, an incomplete local proof,
or an unrelated later PV capture cannot establish persistent danger.

When that baseline loss persists, the card says **Tactical danger in the
position**, retains the real pin/discovered-check lesson and conditional ply
rows, but does not claim that this loss explains the move's inferiority. The
same comparison metadata is retained in the headline and saved timeline. A
double-check mate also now receives the immediate-mate comparison, including a
concrete king escape after a non-checking defence.

Six deterministic regressions cover different replies/themes winning the same
queen, different equal-valued queens, a relocated queen taken by another piece,
less compensation in the actual line, an illegal alternative PV, and the king
escape from a double-check mate. The first proposed g6 mistake in the simpler
queen/bishop position was rejected: Stockfish assessed it within about 8 cp of
best, and the pawn blocks Bxh7's diagonal. Adding an a-pawn and choosing a6
provided a real blunder, with g6 as the engine's better defensive resource.
The deliberately supplied queen-relocation comparisons test the comparison
boundary; they are not labelled as engine-best choices.

These comparisons are bounded material explanations, not complete evaluations
of positional compensation or proof that all later threats are unchanged.
An opposing tactic which starts only after another quiet move remains outside
this first-reply baseline check.

## Deflection and irrelevant credit from a mating line

The inherited deflection label could survive just because a cooperative PV
ended with material gain. The h6/Kh7 control demonstrates the error: Rxe8
Qxd5 is legal, but Black can decline that bait and keep the queen protected.
Material deflections are now reconstructed from a captured bait, its moving
defender and the immediate named-target payoff. Returning the defender to its
original square in a protection-only probe must worsen the target's legal
exchange; a defender that was already pinned cannot receive causal credit.
That probe is not presented as a legal game continuation.

The real bait position is then checked against every legal defence. Each must
permit a profitable capture of the named target or an actual mate-in-one.
Refusing the bait is not assumed to be bad: king escapes, capture alternatives,
checking replies and recaptures are considered. The optional mating-answer
search has a shared 4,096-move cap per proof and abstains when incomplete. This
is still local material/exchange verification, not an unrestricted game-winning
search. Non-capturing deflections and delayed payoffs remain outside this new
proof and must not regain the old endpoint-only acceptance rule.

The extra-rook example also corrected a judgement error: a supplied Qxd5 line
really has a discovered attack on the queen, but fresh Stockfish instead finds
Raxe8# after the same opening moves. A discovered attack on a **non-king** target
can no longer borrow that independent mate's value. Its own proved material
value is retained, and the mating lesson takes priority over that side-effect.
Discovered checks with their own mating proof and the verified king-attraction
branch retain their causal priority. The displayed deflection relationship now
draws the defender's departure and the resulting target capture, not merely the
bait's move arrow.

Five regressions cover the genuine deflection and arrows, the declined bait,
the already pinned defender, preserving the stronger mating lesson, and a
knight-defender/bishop-block example where declining the queen loss permits
Rxf8#. An initial version of that last construction was rejected because a
second rook could recapture the checking rook: it was not mate. The retained
example verifies the actual mating board and both defender branches. These
are source/render-data checks, not running-app visual verification.

## Connected continuation labels

The existing engine positions exposed another source of misleading labels:
the Bxf7+ alternative displayed a Black capture at ply 18 alongside the
immediate weak-f7 lesson, despite ordinary development separating the events.
Timeline labels now stop after two consecutive quiet plies without a capture,
promotion, check, direct material threat or locally verified mating preparation.
Answering check is not a quiet pause. This is a relevance boundary, not proof
that later tactics are absent or every earlier move is forced. The complete
engine line remains visible, and viewing a later position assesses it independently.

The fresh Nxf7 timeline retains fork and weak-f7 evidence at ply 1, the queen
capture at ply 3 and Black's bishop capture at ply 4. It no longer describes
Bxd8 at ply 6 as a newly hanging knight: that knight already won the queen.
The Bxf7+ alternative retains its immediate weak-f7 lesson without the distant
ply-18 label. Counterforks, repeated forks and verified quiet mating preparations
remain covered by the regression suite.

Deferred exchange recognition requires the victim's last arrival on its current
square to have captured approximately its own value or more, including promotion
gain. Moving again clears that credit; a queen which captured only a pawn does
not qualify. Existing immediate-recapture suppression is unchanged. Same-ply
clearance labels are also removed when a discovered attack or check already
explains the line opening.

Six regressions and a rendered-row check cover these boundaries. The same 35
fresh-engine scenarios now include exact f7 timeline assertions; this is not a
larger independent accuracy sample. Long non-mating quiet combinations may need
richer dependency evidence than the two-quiet-ply heuristic.

## Interference must survive defensive choice

Four new constructed positions in `interference-stockfish-18.json` were searched
both unrestricted (three candidates) and with e7 explicitly selected, always
with fresh Stockfish 18 depth-16 searches. The restricted search tests that
candidate; it is not presented as the engine's best move.

In `3k4/1r5q/3PP3/8/8/8/8/K6Q w - - 0 1`, e7+ interrupts Rb7's
defence of Qh7. The old classifier labelled the later Qxh7 as the interference
and accepted the same cooperative line even after removing the d6 pawn.
The new classifier anchors interference to e7+ and checks every legal reply:
king moves lose the queen, while Rxe7 dxe7+ Qxe7 loses a rook for two pawns.
That is a 300 cp local material gain, not a guaranteed queen win. Fresh engine
evaluation is 0: this is a drawing resource from a material deficit, not a
winning position. Without d6, taking e7 safely refutes the supposed tactic.

Moving the black king to c8 changes the judgement again. e7? now loses to
Qg7+ and Qb2 mate, but d7+ is a different, genuine drawing interference.
The position headline must retain that good candidate while rejecting e7.
Finally, with Kb8/Rb7 facing Rb1, the rook is already pinned. Cutting its
horizontal line does not explain the queen's vulnerability: Qxh7 exploits
the existing pin. This exposed and corrected an incidental `Removing the
Defender` headline that credited the queen's defence of the rook instead.

Interference now requires a real pre-existing sliding defence that the move
interrupts. Removing only the new blocker in a protection probe must worsen
the named target's legal exchange; the probe is not a legal variation. Every
real reply must then allow a positive, recapture-adjusted material gain on
that target or the piece taking the blocker. Neither an unrelated loose piece
nor a cooperative PV ending can certify this. Evidence and board arrows name
the blocked defender, blocking square and target; later capture rows remain
secondary. Single-ply and colour-reversed cases are covered.

Removing a defender likewise no longer outranks a capture that already earns
the full proved gain, and cannot borrow an unrelated line's mate flag as proof.
Purely mating defender-removal and delayed/mating interference need additional
causal proofs; this material verifier abstains on those unsupported cases.

Eight new deterministic cases plus the four fresh-engine positions passed,
alongside the existing 35 judgement scenarios. The new restricted-candidate
classification times were 0.6–44.1 ms, excluding engine search. These are
small constructed controls, not a broad accuracy or latency estimate. The
169 focused tests, shared-review worker build and 8,851-module production build
passed; whole-project type checking retains the unrelated OTB fixture mismatch.
No running-app visual or hosting deployment proof was performed.

## Real development-puzzle audit

`real-puzzle-development.json` freezes a reproducible diagnostic selection from
the website's CC0 Lichess 2026-08-02 fixture: the first two **development** rows
for each of sacrifice, intermezzo, capturingDefender, interference, trappedPiece
and quietMove, then deduplication and ID sorting. There are 12 distinct source
games. No holdout rows were selected, and source tags are retrieval metadata,
not required output labels. Each entry retains its source game, FEN, moves and
an explicit judgement, including unresolved failures.

`real-puzzle-judgement.json` records the supplied legal puzzle continuations.
`real-puzzle-stockfish-18.json` records fresh unrestricted MultiPV3 and
root-restricted depth-16 searches for **all twelve** positions, including empty
or imperfect results. Assertions cover the adjudicated improvements only;
successful report creation does not mean twelve correct classifications.

| Puzzle | Current judgement |
| --- | --- |
| 1DoTa | Fork retained; incidental discovered attack on e2 no longer borrows the knight's queen win. Sacrifice proof remains open. |
| 1GRFo | Bb4 interference recovered: the bishop blocks Qa3-Nc5 and attacks the queen. Capturing the blocker loses the queen. |
| 48ION | c7 interference recovered: Qb8-Nf4 is interrupted, the queen is attacked and the pawn threatens promotion. |
| 2QybO | Genuine Nxe6+ d-file line opening retained; unlike the incidental pawn ray, it contributes to the combination. |
| 2SvDe | Intermediate Check explains Bxd2+ before Rxh8, with a legal queen escape if the captures are reversed. |
| 9THyd | Intermediate Check explains Nxe7+ before fxe3. Qxe7 Rxe7 is included, so the lesson does not depend on a cooperative king reply. |
| 2Gc77 | Bxd5 now prioritizes defender removal, with the simultaneous Bb7 attack and Rd8 behind Ne7 explaining different defences. |
| 8DHuj | False clearance removed, but Bxf4's actual removal/overload combination remains missed. |
| 4RNK5 | With sound engine context, Quiet Preparation explains Rb6's verified Rh7+ threat and the Qe4 branch. Other defences change the route; it is not a forced skewer against every reply. |
| 6mAvx | Trapped Ra1 is now primary; Qc3 Bb4 and Qd4 Qxd4 establish why defending the rook fails. |
| 8mguL | Kd6 now has a branch-based trapped-rook proof; Rxb5 Rxb5 limits the guaranteed gain to the exchange. |
| 6fO6p | Winning h4 pawn ending: no invented zugzwang, but the classification/proof boundary remains unresolved. |

Interference proof now includes an attacked defender as a named target and
can settle an immediate promotion by the blocking pawn, including recaptures
and all four promotion pieces. Pawn attack probes must include legal promotion
captures. When the blocker itself attacks the defended piece, a defender-removal
protection probe establishes the relationship before checking all real replies.
That probe is not a claimed legal move. Arrows show both the defensive line
being interrupted and the attack on the defender.

Non-king discovered attacks cannot receive an independently verified moving
piece's fork payoff without contributing more. Clearance needs another piece
to use the vacated square for a check, sound capture or concrete threat inside
the connected episode. It names that use and no longer automatically says
"sacrifice". This is a necessary relevance condition, not a complete forcing
proof for all clearance combinations.

Current verification: 182 focused tests; the 39 earlier fresh-engine scenarios
plus the 12-position diagnostic audit and its targeted assertions; shared-review
worker and 8,851-module production builds. These results expose remaining
failure modes rather than establishing general accuracy. The unrelated OTB
number/bigint fixture still blocks whole-project type checking. No runtime or
hosting deployment or running-app visual verification is asserted.

## Trapped pieces: escape moves and defending resources

The rook in 6mAvx has no legal move after Qxb2, but that alone was insufficient
to justify the old `Trapped Piece` tag. Qc3 and Qd4 defend Ra1: simply playing
Qxa1 then loses the queen. The new proof checks every defence and identifies
Qc3 Bb4 (pinning the defending queen) and Qd4 Qxd4. Fresh Stockfish also selects
Bb4 in the actual Qc3 position. Thus the rook trap is the primary lesson, with
the bishop capture and later rook capture kept as supporting ply evidence.

`trapped-stockfish-18.json` records five fresh-engine controls: the original
trap, an open first rank allowing escape, an initial queen capture that is more
valuable than the extra rook, the missing pinning bishop, and the Qc3/Bb4
defender branch. The unrestricted best move need not match the root-restricted
candidate; both are retained. In the queen-capture control, winning 900 cp
immediately remains primary over the additional 500 cp trapped rook.

The verifier follows the same target through every legal reply and settles
captures/counter-captures. A safe victim move refutes the trap. If another piece
defends it, removing only that new defender in a protection probe must improve
the target exchange; the actual defender must then be capturable or subject to
one verified quiet absolute pin. That pin's every legal answer must concede
the target or its defender. Capturing an unrelated piece, making an unrelated
promotion, or merely ending the PV ahead cannot certify this. A pinned target
does not get a redundant trapped-piece badge beside its pin.

The search is capped at 256 reply/candidate visits and eight pin proofs, each
using the bounded legal exchange verifier. Exhaustion abstains and cannot reuse
a cached success from a larger budget. The trap must win additional material
beyond the initiating capture. This is a local material proof, not a general
search for every positional trap or longer defensive resource.

Mistake comparisons can prove persistence of the same trap or show a legal
escape after a different choice. A supplied Nc3 comparison permits Rb1; h3
and h4 preserve the trap. These are explicit counterfactual controls, not claims
that those supplied moves are the engine's optimal choices. An incomplete
defending-resource proof does not become a claim that a move prevents the trap.

Ten new regressions cover the causal headline, larger initial gain, escapes,
defending queen, absent bishop, castled king, exchange sacrifice, comparison,
duplicate labels and exhausted budgets. The adapter-14 milestone passed 192 focused
tests, the earlier engine scenarios and real-puzzle audit plus the five trap
controls, targeted lint, shared-review worker and production builds. The existing
OTB number/bigint fixture remains the only type-check error. Runtime deployment
and running-app visual proof were not performed; the other open diagnostic
findings above remain unfinished work.

## Branch-aware defender removal (adapter 15)

Real development puzzle 2Gc77 now explains `Bxd5`: Nd5 was protecting Ne7,
the capturing bishop also attacks Bb7, and Ne7 cannot move without exposing
Rd8. `Rxd5 Bxe7`, `Nxd5 Bxd8`, `g5 Bxb7` and `Rf6 Bxb7` have the same causal
headline despite different payoffs. The countercheck `Bxf2+` is answered legally
with `Kxf2`, not ignored. The proof's minimum is 160 cp, not the sum of captures
in an accommodating variation. Removing Bh4 or Bb7 defeats this bounded proof.

The fallback considers only the defended target, the piece behind it on the
same attacking ray, and non-pawn targets attacked by the capturing piece.
Every legal defence must permit a profitable related capture, optionally after
answering one checking counterattack. Legal recaptures and the strongest
alternative off-square capture of an attacking participant are compared, not
double-counted as if the opponent could play both at once. This remains a short
exchange proof, not full positional or arbitrary-depth search. A 4,096-visit cap,
bounded exchange calculations and budget-aware caching enforce abstention when
incomplete. Independent gains cannot lend their value to defender removal.
Multi-target proofs are not refuted by the older single-target mistake-comparison
probe; their complete target set is retained for comparisons of actual lines.
The board now shows the removed defender's relation and the attack on its target.

`defender-stockfish-18.json` records eight fresh engine searches of defensive
branches from two real games. Only the three Bxd5 branch classifications have
acceptance assertions. The five Bxf4 branches remain diagnostic: intermediate
checks and retained material after a target disappears still exceed the proof.
A 100-cp pawn gain minus the 10-cp bishop/knight imbalance must not be discarded;
the fallback permits 90 cp, but this alone does not solve Bxf4. These are branch
checks, not eight independent puzzles or an accuracy estimate.

Adapter-15 verification: 202 focused tests in 21 files, all nine opt-in engine
tests (including the existing real-game audit), targeted formatting/lint,
shared-review worker and production builds passed. Type checking still reports
only the existing OTB number/bigint fixture error. No application restart,
runtime deployment or physical UI verification was performed.

## Quiet preparation without compulsory-PV claims (adapter 16)

Real 4RNK5 now has a useful live/Mistake Review headline: **Quiet Preparation**.
`Rb6` threatens `Rh7+`, after which the short search proves mate or a queen win.
After the engine's `Qe4`, it independently verifies `Rh7+ Qxh7 Rb7+` and the
queen capture. The source-only fixture has no evaluation and intentionally
still abstains; fresh engine classification now covers the lesson. `Kd7`
changes the route and is outside this short forcing proof. It would be false
to call the skewer compulsory against every Black reply.

The bounded search nominates a rook/queen victim from at most seven legal PV
plies, tracks its actual moves, and uses the PV only to order checking moves.
It permits at most two attacking checks followed by a recapture-adjusted capture,
tests every intervening legal defence, accounts for captures/promotions, and
stops after 16,384 visits. The quiet mover must join the checking combination
or clear another checking piece's path. If an all-root-defences proof fails,
both an ignored-threat probe and the actual supplied reply must independently
pass. This weaker result is medium confidence, explicitly conditional, and
requires a finite root evaluation of at least -30 cp. It cannot originate
speculative labels in later unevaluated PV rows. Cache keys include the actual
defensive reply, nominated victim and checking hints; smaller budgets cannot
reuse successful larger-budget proofs.

The timeline now places the rook sacrifice on `Rh7+`, the skewer on `Rb7+`,
and the queen capture on its actual ply. A previous ghost called that profitable
queen capture a sacrifice: generic sacrifice proposals now also require a real
local material offer (at least 90 cp exchange loss), and incomplete exchange
calculations do not qualify. This is a necessary condition, not a complete
general theory of positional or deferred sacrifices.

Nine new checks cover the real lesson, missing/losing/non-finite engine context,
an added Nd8 that refutes the skewer with Nxb7, a different king-defence branch,
budget exhaustion, live arrows and Mistake Review's primary/secondary choice.
The fresh before/after engine benchmark also compares Rb6 with the missed
opportunity after Rxh3. These are focused controls, not a general accuracy rate.

Adapter-16 verification: 211 focused tests in 22 files, all nine opt-in engine
tests, targeted formatting/lint, shared-review worker and production builds.
The existing OTB number/bigint fixture error remains. No runtime deployment or
running-app proof is claimed. Longer quiet combinations, Bxf4's repeated-check
branches and broader sacrifice/intermediate-move judgement remain open.

## Intermediate checks that genuinely improve the move order (adapter 17)

Two real-game misses now prioritize **Intermediate Check** rather than a loose
piece label. In 2SvDe, `Bxd2+` comes before `Rxh8`; the combined local minimum
is 1,070 cp. In 9THyd, `Nxe7+` comes before `fxe3`, preserving a 650 cp minimum.
`Qxe7 Rxe7` is a related alternative payoff, so the second lesson remains the
same even when the defender captures the checking knight instead of moving
the king. The deferred capture is nominated from legal moves in the position,
not from the particular engine reply shown in the PV.

The classifier requires both captures to be legal initially, checks every
legal answer to the checking capture, and requires at least 90 cp beyond the
better standalone capture after legal exchanges. It then reverses the capture
order and finds an actual move that saves the first victim from immediate
profitable capture by **any** friendly piece, or removes its attacker. This
is a concrete immediate move-order comparison, not a complete engine evaluation
of every reversed continuation. Candidate/escape visits cap at 512; individual
exchange proofs retain their existing budgets, and incomplete work abstains.

Raw PV `intermezzo` tags no longer pass on terminal material alone. The main
lesson is reconstructed only at the evaluated root; later intermediate checks
are assessed separately on the conditional timeline. This matters: two existing
pin-refutation controls initially exposed ghost headlines from a later checking
capture after an unproved `d6`. Those later positions can be tactical without
making the original move sound. Same-ply hanging-piece duplication is removed,
and board arrows show the capture being deferred. When removing a defender
already explains the same target and gain, a redundant Intermediate Check badge
is suppressed; the specific defender-removal mechanism remains primary.

Seven new tests cover both real positions, the alternative queen recapture,
an absent supporting rook, no check, no move-order advantage and an exhausted
budget. Four fresh before/after Stockfish scenarios test both directions:
missing each intermediate check and allowing it through the preceding real-game
mistake. All four choose the intended primary/source. The twelve-game diagnostic
and all existing engine reports were refreshed without selecting holdout data.

Adapter-17 verification: 220 focused tests in 23 files, all nine opt-in engine
tests, targeted formatting/lint, shared-review worker and production builds.
The unrelated OTB number/bigint fixture error remains. No runtime deployment or
running-app proof is claimed. Non-capturing/delayed intermediate moves, arbitrary
reversed continuations, Bxf4's longer branches and broader tactical judgement
remain unfinished work; these checks are not a general accuracy estimate.

## Tag-blind expansion, crash safety and terminal lessons (adapter 18)

The [expanded review](expanded-review.md) inspects 32 additional positions from
distinct real source games, selected by a fixed salted hash of development IDs
before classification. Themes, rating, line length and classifier output do not
select the cases. The frozen fixture records its source hash and omits theme
labels. Its parent corpus is theme-balanced and mate-heavy; this is not a random
sample of ordinary mistakes or an accuracy estimate.

The expansion exposed a legal en-passant crash, a checkmate incorrectly led by
Hanging Piece, duplicate generic mate entries and a skewer claiming material
after the game had already ended. These are fixed. Immediate mate is also
reconstructed without relying on a primitive tag. Same-target/gain deflection
and Intermediate Check collapse to the more specific deflection; underpromotion
does not also need a generic Promotion badge. Causal pins/discoveries that explain
mate remain eligible, and earlier material gains are not indiscriminately erased.

Every source line is retained in `expanded-judgement.json`, including misses.
Seven investigated positions also have fresh unrestricted MultiPV3 and
root-restricted searches in `expanded-stockfish-18.json`. Legal replay and crash
freedom do not mean every displayed lesson is correct. Important open examples
include a promotion-backed fork, a fork requiring an intervening queen exchange,
a quiet pin enabling a fork, and the longer en-passant attack. Named-mate overlap
also needs independent adjudication; see the position-by-position review.

Adapter-18 verification: 229 focused tests in 24 files, all ten opt-in engine tests,
targeted formatting/lint, shared-review worker and production builds. Type checking retains
the unrelated OTB number/bigint fixture error. No runtime deployment or
running-app proof is claimed.

## Forks backed by a threatened promotion (adapter 19)

Real CSh8J now explains `Nd5+` as the primary Fork: it attacks Kf6 and Nb6,
and Nb6 also guards c8. A king move loses the knight; `Nxd5` abandons that
guard and permits `c8=Q`. The local minimum is 320 cp, not the selected PV's
480 cp promotion balance or Stockfish's complete-position evaluation.
Promotion remains secondary evidence at ply 3. Board arrows connect the
forking knight to both targets and show Nb6's defence of c8 and the c7-c8 push.

The fallback nominates only a pawn one step from promotion whose promotion
square is guarded by a fork target. All four immediate promotion choices are
checked **before** the fork, so an independently profitable promotion cannot
lend a win to an unsound double attack. Testing this with a null move after a
checking fork would incorrectly prevent the defender from recapturing. Every
legal reply must then yield a net gain on the named fork targets or that same
pawn, using the existing bounded legal exchange proof. Captures, promotion
recaptures and promotion stalemate are considered; checking replies that still
need an unproved continuation do not qualify. A concrete defender-captures-forker
branch must permit a sound queen promotion. This remains a local proof, not a
general pawn-ending search or coverage of all underpromotion-only escapes.

Eight regressions cover the real line, an alternative king reply, one-ply input,
secondary timeline and arrows, the mirrored Black case, an absent pawn, an
additional promotion guard and an unrelated passed pawn. Two fresh before/after
Stockfish scenarios choose Fork as the missed primary after `Kxg3` and the
allowed primary after `...Kf6`; the better `...Nc8` avoids the immediate fork.
The expanded fresh-engine report now asserts CSh8J's root lesson as well.

Adapter-19 verification passed 224 selected regression tests in 23 files, all ten opt-in
engine tests, targeted formatting/lint, shared-review worker and production
builds. Type checking retains the known unrelated OTB number/bigint fixture
error. Only CSh8J's headline changes in the frozen 32-position expansion.

The remaining queen-exchange fork and quiet-pin combinations are still open;
they are not converted into successful empty-result tests. No running app or
hosting deployment is asserted.

## An overloaded shared defence, not just a fork (adapter 20)

Further inspection corrected the earlier G8wdr judgement. `...Ne5` attacks
Qd3/Bc4 **and uncovers Rd8 against Nd4**. The queen cannot defend both minor
pieces while escaping: `Qf1` loses Nd4, while `Qc3` allows `Qxc3 bxc3 Nxc4`.
The primary lesson is Discovered Attack. Calling it only a fork omits the rook
that makes other queen escapes fail; the website's defender-removal tag names
the exchange branch, not the initiating move. No source tag is treated as truth.

The new fallback nominates only an actual uncovered battery and its moving
piece's attacked targets. After every legal reply, it checks captures of those
targets (or a checking attacker); when a target supplies a shared defence, one
capture of that defender may precede the payoff. Every reply to this capture
is checked, including refusing the exchange and up to two checking counterattacks.
All nested visits share one 8,192-node budget; unknown results abstain and small
budgets cannot reuse cached successes. The existing exchange-leaf policy debits
the stronger of an immediate recapture and an off-square capture of an attacking
participant, rather than double-counting both as simultaneous moves.

Checking sacrifices exposed a separate limitation: after taking a donated
target, the proof demanded another capture even if the opponent saved the
remaining target. It now permits an actual legal non-capture that retains the
earned gain after settling exposed participants; a null move is not evidence.
Checking evasions track their moved piece too. The original defender-removal
callers keep their one-check limit, while this exchange fallback permits two.
This remains local material verification, not a complete positional evaluation.

The current minimum is 150 cp. The source fixture, one-move input, queen-escape
line and successive checking sacrifices retain the same root lesson; removing
either Rd8 or Qa5 rejects it. Board arrows show the new rook ray and knight
attacks, not the conditional future queen-exchange destination. Six fresh
Stockfish branch searches are recorded in `exchange-discovery-stockfish-18.json`.
Two before/after scenarios additionally test the actual source game's `Nxd4`
mistake and the missed opportunity after `...Be7`.

The latter caught a ranking bug: a smaller Qf5+ fork at ply 5 of the allowed
line displaced the missed Ne5 discovery at ply 1. A verified root lesson now
outranks a conditional later material motif in either direction; mating
consequences retain priority. When only a later allowed material motif is
available, the explanation calls it conditional rather than an immediate
refutation. Such motifs remain visible on the per-ply timeline.

Only G8wdr's headline changes in the frozen 32-position sample. The quiet pin
in w1lKu, other long combinations, named-mate overlap and broader candidate
coverage remain open. This is development evidence, not general accuracy,
holdout validation or running-app/hosting deployment proof.

Adapter-20 verification passed 237 selected regression tests in 24 files, all eleven
opt-in Stockfish tests, targeted formatting/lint, shared-review worker and
production builds. Type checking retains only the unrelated OTB number/bigint
fixture error. Classification timing is recorded per branch; it includes the
conditional timeline, varies with concurrent host work and is not a UI latency
guarantee.

## Checking clearance into different quiet preparations (adapter 21)

Real w1lKu corrects another incomplete early judgement: `Bh7+` does not force
`Kf8`. `Kh8` is legal and changes the mechanism. The useful root lesson is
**Clearance**: moving Bd3 clears the third rank for Qb3. `Kf8` permits `Qf3`,
pinning f7 and enabling `Nxe6+`; `Kh8` permits `Qh3`, followed by a forcing attack.
The latter must include `Bxf7+ Rxf7 Qh7+` as well as the selected king-capture
route; it can require four checks before the queen capture.

The clearance proof nominates a rook/queen victim from at most 13 supplied
plies, then checks every legal reply independently of the supplied king move.
Each branch must have a legal quiet slider move through the genuinely vacated
square and a mate/material proof with at most four following checks. Outer and
inner work share 32,768 visits. An equally good already-available forcing attack
disqualifies that branch: the opened queen route cannot borrow an independent
rook attack. Unknown/budget-exhausted work abstains; captures and non-checking
clearances remain outside this particular fallback.

Quiet preparation now admits a stationary checking slider and a new absolute
pin that prevents a checking piece's recapture. Removing only the pinner must
make that recapture legal; alignment alone is not enough. Its supplied horizon
is at most 11 plies, with two to four checks before the named payoff and the
existing 16,384-visit limit. The initial piece's identity remains tracked: after
it is captured, a different piece arriving on its square cannot supply its
participation. Existing conditional-result engine gates remain unchanged.

The source branch shows Clearance at ply 1, the created Pin at ply 3 and the
fork at ply 5. Pin evidence distinguishes creation from exploitation and states
why the pawn cannot recapture. Root board arrows show the queen route for the
actual king reply; pin arrows show the king/pawn alignment and the checking
knight move. Neither arrow set asserts that one king reply is compulsory.

Ten new regressions cover both routes, the four-check defence, actual ply
placement/arrows, a bishop capturing the prepared queen, an unrelated pawn move,
an independent open-file rook attack and exhausted budgets. Five fresh engine
diagnostics are in `pin-preparation-stockfish-18.json`; two before/after scenarios
add the real `Qxd4` mistake and missed clearance after `Bb1`. Only w1lKu's headline
changes in the frozen 32-position sample. This proof's 100 cp local lower bound
is not Stockfish's whole-position score or a claim that merely winning a pawn
is the full point of the combination.

The en-passant attack, other long combinations, named-mate overlap, broad
candidate coverage and physical/runtime validation remain open. These remain
development judgements, not a general accuracy claim or holdout validation.

Adapter-21 verification passed 247 selected regression tests in 25 files, all
twelve opt-in Stockfish tests, targeted formatting/lint, the shared-review worker
build and the 8,851-module production build. Type checking retains only the
unrelated OTB number/bigint fixture error. These checks do not establish running-app
latency or deployed UI behaviour.

## Long mating claims and payoff noise (adapter 22)

The previous mate gate checked alternative defences for three- and five-ply
lines, but accepted longer lines merely because their endpoint was checkmate.
That is not evidence of a forced attack. Real 4Osgg supplied a reproducible
counterexample: add a White rook on c1, retain the legal seven-ply source mate,
and the old result still claimed Black's mating pattern. White can instead
play Rxf1. Fresh Stockfish analysis finds Black losing to mate after that reply.

Long mating claims now require an all-defences checking proof: the supplied
line only nominates a horizon and orders attacking moves. Every legal defence
must have a checking answer leading to mate, within at most seven attacking
moves and 32,768 total visits. Budget exhaustion, drawn leaves, attacks needing
unproved quiet moves and longer horizons remain unknown. Short mating proofs
and quiet-preparation proofs retain their existing independent bounds.

In real 4Osgg, Qf1+ now leads with **Forcing Mate**, with one factual checkmate
payoff at ply 7. After Qg1+, both Kh3 and Kg3 are legal: the latter permits
Bf2+ Kh3 Qh1#, not the source's Bf2# ending. The root certificate covers both.
`checking-mate-stockfish-18.json` records these fresh searches and the losing
rook-control search. A before/better-line comparison also recognizes an
existing certified mate after both choices; it does not blame one pawn move
for creating that danger. The alternative must prove an equal or shorter
mating bound, so a move which only delays mate is not silently equated.

Terminal mate tags are anchored to the actual checkmate, not a legacy early
check/capture. Multiple names for that one event are consolidated: a single
named pattern survives with factual SAN/checkmate evidence; conflicting names
fall back to Checkmate pending taxonomy adjudication. Repeated mate countdowns
for the same already-certified attack are suppressed, while concrete secondary
mechanisms remain. A root mating sacrifice can still outrank generic Forcing
Mate; a later conditional attraction cannot. Unproved material-attraction
proposals are withheld rather than borrowing a cooperative endpoint. En-passant
evidence likewise anchors to the actual pawn capture and names the removed
pawn, fixing OezHt's former attribution to the final bishop move.

`checking-mate-development.json` broadens the audit to **all 32 development
rows** whose complete legal line starts with check, has at least seven plies
and ends with the attacker's mate. Selection ignores tags, rating and classifier
output; no holdout positions are classified. The bounded proof certifies 27,
all with a root-ply primary lesson. The five remaining rows are open, not true
negatives: 3kPn3, 8FLlO and IyijS have quiet moves in their supplied attacks;
eimKB exceeds the horizon; hajE5 fits the horizon but is not certified by this
bounded search. These counts measure proof coverage within a selected mating
family, not tactical accuracy or complete motif correctness.

Within the separate frozen 32-position mixed expansion, only 4Osgg changes
headline; terminal consolidation reduces timeline entries from 51 to 40.
That reduction is not an accuracy metric. Four additional real positions
explicitly check early payoff anchors/root ranking, alongside the en-passant
case, both-colour controls, omitted king defence, budget and causal tests.
Broader long-combination coverage, material attraction, named-pattern taxonomy,
ordinary-game noise and actual running-app behaviour remain unresolved.

Adapter-22 verification passed 261 selected regressions in 26 files, the
opt-in 32-position corpus audit, all thirteen fresh Stockfish tests, targeted
formatting/lint, the shared-review worker and the 8,851-module production
build. Type checking retains only the unrelated OTB number/bigint fixture
error. No runtime restart, hosting deployment or GUI verification was performed.

## Checking fork preparation and branch-independent lessons (adapter 23)

Real fJrhT previously displayed only the ply-3 fork. That omitted the useful
move-order lesson: **Rb1+ first**, then Nd3+. Fresh root-restricted Stockfish
scores Rb1+ at +459 cp and immediate Nd3 at 0 cp. Kf2 permits Nd3+'s king/rook
fork, but Kf2 is not compulsory: Rc1 blocks, and Rxc1+ wins that rook directly.
The new root lesson is Fork Preparation in either continuation, even when only
Rb1+ is supplied. Its proof does not inspect the supplied PV at all.

Every legal reply to a non-capturing check must permit either a profitable
checking fork or a profitable capture of the interposing piece by the checking
piece. Every defence to a nominated fork is then checked, including capturing
the forker and legal recaptures. Targets are tracked through defensive moves;
captured/promoted material and the stronger of an immediate recapture or an
off-square loss of an attacking participant are debited. The same checking
fork must not already work without the preparation. Work has a 4,096
traversal/leaf-operation budget plus the existing bounded 256-node exchange
leaves; unknown/exhausted proofs abstain and cannot borrow cached success from
a larger budget. Castling's encoded rook destination is not treated as an
occupied checking-piece square. Capturing checks, quiet double threats and
longer fork setups remain outside this particular proof.

The original square relationship matters. With the White rook on e5 instead
of c5, Re1 blocks safely because Rxe1+ Kxe1 only exchanges rooks. That control,
a knight capturing the checking rook and a pawn capturing the future forker
all reject the cooperative supplied fork. Current board arrows show Rb2-b1
and the actual b1-f1 checking ray, not a knight supposedly already on d3. The
fork and rook capture remain at plies 3 and 5. A same-target before/better-line
comparison prevents two irrelevant pawn moves from being assigned different
causes for an already existing preparation.

`fork-preparation-stockfish-18.json` records the root move-order comparison,
the Rc1 branch, NGZzo and opGD7 (subsequently addressed below). Fresh before/after searches in
`causal-stockfish-18.json` verify the actual Rc5 mistake (Ra5 preserves the
draw) and the missed preparation when Black plays Nd3 too soon. The proof's
500 cp local material gain is not Stockfish's whole-position score.

The then-unresolved opGD7's Qf1+ Kd2 Bf4+ Re3 Qf2+ Bxe3 involves a longer king drive
and pin; a later pin alone still does not explain the initiating check.
It was not counted as a correct empty result; adapter 25 adds its root proof below.

Only fJrhT's headline changes in the frozen mixed 32-position expansion.
The live selector also now accepts validated mate-distance IDs beyond five
moves: O3OKR and nUdHj retain their proved mate-in-six root lesson instead
of dropping it in favour of a later payoff. Ordinary-game noise, quiet/longer
preparations, the previously recorded five unresolved mating attacks and real
runtime verification remain open.

Adapter-23 verification passed 275 selected tests in 27 files including the
opt-in development corpus audit, all fourteen Stockfish tests, targeted
formatting/lint, the shared-review worker and the 8,851-module production build.
Type checking retains only the unrelated OTB number/bigint fixture error.
These are source/build checks, not running-app or hosting deployment proof.

Run in PowerShell with the configured Node runtime on PATH:

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = 'absolute path to a local Stockfish executable'
$env:TACTICAL_JUDGEMENT_REPORT = 'benchmarks/tactical-relevance/stockfish-18.json'
$env:TACTICAL_CAUSAL_REPORT = 'benchmarks/tactical-relevance/causal-stockfish-18.json'
$env:TACTICAL_QUIET_REPORT = 'benchmarks/tactical-relevance/quiet-stockfish-18.json'
$env:TACTICAL_MATERIAL_REPORT = 'benchmarks/tactical-relevance/material-stockfish-18.json'
$env:TACTICAL_DISCOVERED_REPORT = 'benchmarks/tactical-relevance/discovered-stockfish-18.json'
$env:TACTICAL_INTERFERENCE_REPORT = 'benchmarks/tactical-relevance/interference-stockfish-18.json'
$env:TACTICAL_REAL_ENGINE_REPORT = 'benchmarks/tactical-relevance/real-puzzle-stockfish-18.json'
$env:TACTICAL_TRAP_REPORT = 'benchmarks/tactical-relevance/trapped-stockfish-18.json'
$env:TACTICAL_DEFENDER_REPORT = 'benchmarks/tactical-relevance/defender-stockfish-18.json'
$env:TACTICAL_EXPANSION_ENGINE_REPORT = 'benchmarks/tactical-relevance/expanded-stockfish-18.json'
$env:TACTICAL_EXCHANGE_DISCOVERY_REPORT = 'benchmarks/tactical-relevance/exchange-discovery-stockfish-18.json'
$env:TACTICAL_PIN_PREPARATION_REPORT = 'benchmarks/tactical-relevance/pin-preparation-stockfish-18.json'
$env:TACTICAL_CHECKING_MATE_REPORT = 'benchmarks/tactical-relevance/checking-mate-stockfish-18.json'
$env:TACTICAL_FORK_PREPARATION_REPORT = 'benchmarks/tactical-relevance/fork-preparation-stockfish-18.json'
$env:TACTICAL_ORDINARY_GAME_REPORT = 'benchmarks/tactical-relevance/ordinary-games-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node
$env:TACTICAL_REAL_PUZZLE_REPORT = 'benchmarks/tactical-relevance/real-puzzle-judgement.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/realPuzzleJudgement.test.ts --environment node
$env:TACTICAL_EXPANSION_REPORT = 'benchmarks/tactical-relevance/expanded-judgement.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/expandedTacticalJudgement.test.ts --environment node
$env:TACTICAL_CHECKING_MATE_SOURCE = 'absolute path to chessmistaketrainer/benchmarks/tactical-classifier/lichess-2026-08-02-fixture-v1.jsonl'
node node_modules/vitest/vitest.mjs run src/utils/tests/checkingMate.test.ts --environment node
```

The engine test is opt-in and starts no engine during normal unit tests.
`causalTactics.test.ts` separately checks poisoned f7 captures, a capturable
geometric fork, a truncated refutation, equal queen exchanges, illegal PV
boundaries, losing alternatives, and the priority of missed mate over a smaller
allowed material loss. Existing tests retain the multi-step rook fork and pin.

## Quiet double threats with separate payoffs (adapter 24)

Real NGZzo now leads with **Double Threat**: Nd7 attacks Rb6 and threatens
Nf6+, forking Kg8 and Qh5. The supplied source line, Nd7 Kg7 Nxb6, never
actually plays the fork. Calling Nd7 a fork would be false; calling the rook
simply trapped would omit why escaping with Rb7 does not solve the problem.
The independent root proof checks all 35 legal replies. Both a direct capture
route and a checking-fork route against different material must be necessary.
This is not a generic detector for every possible pair of threats.

The direct attack must be newly created by the moved piece. A null-move
position nominates candidate checking forks by that same piece, but cannot
prove them: every actual defence, followed by every defence to the fork, must
permit a net gain. An equally profitable checking fork already available
before the root is rejected. Captures of the attacking piece, checking target
sacrifices, promoted/captured material, recaptures and attacking-participant
liabilities are included. Search shares an 8,192-operation budget with
bounded 256-node exchange leaves and a 128-entry root cache; exhausted or
unproved branches abstain. Cache hits cannot bypass an explicitly smaller
budget. The earlier checking-preparation search reuses the same fork evaluator.

The proof's minimum local gain is 180 cp (an exchange), not the engine's
whole-position evaluation or a promise to win a rook against best play.
Fresh restricted searches retain Nd7 at +264 cp and the Rb7 branch at +532 cp.
Unrestricted before/after searches prefer Bg6 before the actual g6 error,
then Nd7 at +294 cp. A missed Nd7 after Ke1 also gets the correct primary
source. Their full classification calls took about 61 and 74 ms in this run;
these are local classifier timings, not end-to-end live UI latency.

Root arrows show Nc5-d7 and Nd7-b6 only. Words describe Nf6+'s future fork;
the king/queen fork belongs to ply 3 if that continuation is selected.
Queen removal, a knight capturing Nd7 and a pawn capturing Nf6 reject the
cooperative line. A same-target, same-net-gain counterfactual recognizes an
existing double threat after unrelated pawn moves, but does not equate a
cooperative whole-rook loss with a proof guaranteeing only an exchange.

Only NGZzo's headline changes in the frozen mixed 32-position expansion.
The frozen checks are development diagnostics, not a general accuracy score;
holdout labels were not tuned against. Twelve dedicated regressions,
287 selected tests across 28 files, all fourteen fresh-engine tests, targeted
format/lint, the shared review worker and production build pass. Type checking
retains the unrelated OTB number/bigint fixture error. Desktop/phone share the
adapter in source; Outpost, website primitives and live deployments are unchanged.

## Checking attacks with branch-dependent material or mate (adapter 25)

Real opGD7's three-ply source stopped after Qf1+ Kd2 Bf4+, before the
material payoff. A full Stockfish line previously showed only Pin at Qf2+,
which did not explain Qf1+. The new root lesson is **Forcing Attack**. It
works from the short source, full engine lines and Qf1+ alone. The source has
no silver mechanism tag; agreement with that empty tag set is not the goal.

Every legal root reply (Kc2, Kd2, Re1) and every subsequent defensive reply
is checked independently. A non-capturing direct check nominates either a
material target in a short all-checking continuation or the highest-value
non-king piece it attacks now. PV moves only order the search. The proof
allows three additional checking moves before a settled target capture;
branches may prove mate instead. It tracks target identity, captured and
promoted material and the moved attacking participants' exchange liabilities.
It abstains on unknown/terminal defensive resources and exhaustion of the
shared 16,384-operation budget plus bounded exchange leaves. Its 128-entry
cache cannot bypass an explicitly smaller budget. An equally profitable
immediate capture available before the check disqualifies the preparation.
Discovered checks and castling's vacant encoded destination are left to their
existing specialised classifiers, not drawn as fictitious direct checks.

The first successful local proof guarantees 170 cp (an exchange), not the
maximum available gain or a full engine evaluation. In its Kd2 branch,
Bf4+ Re3 Bxe3+ Kxe3 already wins an exchange. Stockfish finds the stronger
Qf2+ first and then Bxe3, retaining the bishop. Kc2 and Re1 independently
allow mate in three in fresh searches, but the material certificate does not
need to solve those mates before proving the root win. This distinction is
intentional: the classifier must not call one branch's pin an inevitable
mechanism, or call the whole position forced mate when Kd2 avoids it.

Specific proved root mechanisms, such as Fork Preparation, outrank and
suppress the generic attack label. The timeline does not repeat Forcing
Attack after every check. Root arrows show Qf3-f1 and the real f1-d1 checking
ray; the fork/pin/capture and terminal mate remain on their actual plies.
Pin prose now distinguishes a newly created pin from continuing an attack on
an already-pinned piece, including the e3 rook at Qf2+.

Fresh before/after searches prefer Kc1 (+188 cp for White) before the actual
Re2 error, then Qf1+ (+614 cp for Black). Black's a5 misses that attack and
allows Qg4, leaving White at +9 cp. Be7 instead hangs a bishop to Qxe7:
the immediate bishop loss properly leads that explanation, while missed
Qf1+ remains separately classified. These calls took about 26, 36 and 53 ms
respectively in this run, not including engine search or UI latency.
The initial expectation that Be7 should headline the missed attack was
rejected on this concrete chess evidence, not enforced on the output.

Missing-bishop, checker-capture and already-available-capture controls reject
the attack claim. Equivalent pawn moves with the same forced exchange loss
retain existing-danger comparison. Only opGD7's headline changes in the
frozen mixed 32-position expansion. Sixteen new regressions, 303 selected
tests in 29 files, all fourteen fresh-engine tests, targeted format/lint,
the shared review worker and production build pass. Type checking retains
the unrelated OTB number/bigint fixture error. These are development/source
proofs, not general accuracy, Outpost/website parity or live deployment proof.
Quiet continuations, different target nominations, longer attacks and tighter
maximum-gain proofs remain future work.

## Ordinary-game noise audit (adapter 26)

`ordinary-games-development.json` freezes complete legal mainlines from all
three games in one complete public archive before classifier inspection.
Every fifth reached ply from 8 through 60 yields 24 positions with alternating
sides, without score/result/theme selection. `ordinary-games-stockfish-18.json`
records fresh before/after depth-16 MultiPV3 searches, live scans with actual
previous-move context, and causal review explanations. The complete human
judgement, fixes and unresolved findings are in `ordinary-games-review.md`.

This found two concrete false tactical labels: an incidental bishop skewer
in a mating alternative, and a normal bishop/knight recapture described as a
hanging bishop. Mating endpoints no longer automatically validate unrelated
pins/skewers. Verified matching root history now shares the timeline's
compensated-capture filter, without hiding real mating recaptures or accepting
mismatched history. Mate-in-one positions omit longer mating alternatives.

Adapter 26 established 17 empty live headlines and six accepted immediate lessons;
its seventh non-empty result, f7+'s mate in seven, incorrectly led with
a smaller proved material idea. The adapter 27 milestone below supplies the
missing mating proof. Quiet development, forced evasions and compensated
recaptures have fixed regression judgements, while genuine capture and mate
controls remain. This is a small developmental noise diagnostic, not general
accuracy, end-to-end UI latency or deployment proof.

Run the ordinary-game audit alone with `TACTICAL_JUDGEMENT_ENGINE` and
`TACTICAL_ORDINARY_GAME_REPORT` set:

```powershell
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'output-blind longitudinal'
node node_modules/vitest/vitest.mjs run src/utils/tests/ordinaryGameJudgement.test.ts --environment node
```

The committed mainlines need no network. The opt-in `TACTICAL_GAME_SOURCE`
freezer is not part of routine verification; do not refetch or change the
sample while comparing classifier versions.

Verification passed 332 selected regressions in 30 files, all fifteen fresh
engine tests, targeted format/lint, the shared review worker and production
build. The earlier frozen 32-puzzle headlines are unchanged. Type checking
retains only the unrelated OTB number/bigint fixture error.

## Quiet moves inside forcing mates (adapter 27)

The ordinary-game `ordinary-2:ply18` position is now explained as a forced
mating attack, not its smaller material fork. The independently replayed
Stockfish line is `f7+ Ke7 fxg8=B Rxg8 Bc4 Bg7 Qf7+ Kd6 Ne4+ Kc6 Qd5+ Kb6 Qb5#`.
Checking-only search could not certify the non-checking promotion or Bc4;
the relevance window also stopped before the mate was considered.

The root still must give check and the nominated mate must finish within
seven attacking moves. Search may now try at most two PV-nominated
non-checking moves, but enumerates **every legal defence** after each, not
only the displayed recaptures or bishop reply. It memoizes completed states,
orders the nominated move by ply, safely excludes impossible checking
candidates, and has a 65,536 examined-move ceiling. Failure, exhaustion and
invalid budgets abstain; a warm cache cannot bypass a smaller explicit budget.
The candidate filter retains discovered checks, en passant, castling and all
promotion roles. This bounded search remains incomplete, not a replacement
for the engine.

Only a successful proof connects the quiet preparation to the terminal
timeline event. Its verified mate outranks lesser material side effects,
including a loose rook captured with check. A checkmating move no longer
claims an irrelevant fork, skewer, trapped/loose piece or discovered material
attack just because there are zero legal replies. Actual checkmate and
concrete checking mechanisms remain separate. The promotion description is
factual: the displayed recapture erases the promoted role, but that alone
does not prove all promotion choices equivalent against other defences.

The same general change recovers two previously unproved development mates:
`3kPn3` (`Qh4+`, then quiet `g3`) and `IyijS` (`Rc6+`, then quiet `Rch6`).
The frozen long-mate diagnostic moves from 27/32 to 29/32 proved roots.
`8FLlO` and `hajE5` remain unproved; `eimKB` exceeds the seven-move bound.
These are development coverage counts, not held-out accuracy. All 32 earlier
mixed-puzzle primary labels and the other 23 ordinary-game headlines are
unchanged. The ordinary sample retains 17 empty headlines and now has seven
accepted positive lessons.

Fresh depth-16/MultiPV3 before/after searches confirm the real Ke8 mistake:
Mistake Review leads with the mating attack and explains that Kxf6 would
remove the checking pawn. The recorded full f7+ scan takes 743 ms after engine
analysis; its subsequent review takes 44 ms with proof caches warm. These are
test-harness timings, not end-to-end desktop measurements. The fifteen fresh
engine tests, focused regressions, shared review-worker build and production
build pass. Type checking retains the unrelated OTB number/bigint fixture error.

`mixedMate.test.ts` retains the real position, quiet-reply and root-capture
counterexamples, terminal-label and budget checks, and the actual mistake's
explanation. `checkingMate.test.ts` retains the two recovered real mates and
the capturing-check priority regression. All report regeneration commands
above remain applicable. Website primitives, Outpost and running apps are
unchanged; no deployment or physical UI proof is claimed.

## Continuing threats versus new events (adapter 28)

The secondary-event audit found two precise redundancies, not a reason to
hide every repeated theme. In `ordinary-2:ply18`, Qf7+ and later Qd5+ describe
the same queen's uninterrupted profitable attack on Rg8 during the mating
sequence. The first fork remains at ply 7; its repeated label at ply 11 is
removed. In `w1lKu`, Qf3 creates the pin at ply 3, then Nxe6+ exploits it to
fork king and queen at ply 5. The duplicate Pin badge at ply 5 is folded into
the fork's factual explanation, while the pin's creation stays visible.
The fork's board evidence includes the Qf3-f8 pin ray as well as both knight
attacks, so reducing labels does not remove the reason the pawn cannot capture.

This is identity- and position-aware timeline normalization, not theme-ID
deduplication. The same attacker must retain the same profitable material
victims through every intervening legal position. A broken threat, a new
attacker or victim, a capture or promotion keeps a distinct event; primary
lessons are never removed by this secondary filter. A newly created pin is
also retained. Legal exchange tests reject an apparent extra bishop target
defended by a pawn and a checking queen's supposed fork when a rook can take
the queen. Existing tests still retain the two-knight/two-rook fork sequence.
Normalization is idempotent and preserves actual plies and input evidence.

Fresh engine reports and the frozen development audits show only those two
primary-line timeline removals across the 24 ordinary positions, 32 mixed puzzles and 32
long mates. Their primary labels are unchanged; long-mate proof coverage is
still 29/32. The ordinary f7+ scan measured 708 ms after engine analysis,
with subsequent warm-cache review at 44 ms; this is not evidence of a speed
improvement or real UI latency. Seven new regressions and the updated
pin-creation/exploitation test cover the changes, including retained board
arrows. The full selected suite passes 354 tests in 32 files (three opt-in
tests skipped), all fifteen fresh-engine tests pass, and shared review-worker
and production builds pass. The unrelated OTB number/bigint type-checking
error remains. Runtime deployment, website primitives and Outpost are unchanged.

## Defender removal for promotion (adapter 29)

The frozen mixed sample's MJZcU is no longer an empty scan. Rxe4 removes the
knight that controls d2, allowing the connected c3/d4 passed pawns to overcome
the rook after fxe4. This is a promotion combination, not a hanging rook or
a generic sacrifice badge. The source line ends in c1=Q; a fresh unrestricted
Stockfish 18 depth-16 MultiPV3 search prefers Rxe4 at +267 cp and promotes the
d-pawn instead. Premature c2 scores -172 cp: Rd7+ and Rc7 let the rook and
knight stop the pawns. The before/after mistake audit now teaches the missed
defender removal when that premature push is supplied. That candidate move
is a tested counterfactual, not an assertion about the source game's move.

The proof is independent of the supplied cooperative replies. It nominates
one to three advanced passed pawns only when the captured non-pawn piece
legally controls their advance. It searches every defensive reply against
the nominated pawns, surviving capturing piece, king escorts and legal check
evasions, for at most eight further attacking moves and 131,072 examined
moves. Its leaves settle local material against immediate legal exchanges
and mate-in-one resources; they are not a full-game minimax evaluation.
A representative branch must include the attacker's promotion. The real
position needs 96,274 examined moves and answers all 21 legal root replies;
its longer witness includes several rook checks and king evasions before
promotion. A six-move continuation bound was insufficient for those checks.
Exhausted proofs abstain. Search order is rank/colour-reflection invariant,
and a smaller caller budget cannot borrow a cached default-budget success.

The primary card explains Ne4's control of d2, with board arrows e4-d2,
c3-c2 and d4-d3 alongside the root capture. The promotion remains secondary
at its real ply, and the timeline ends there; a promotion outside the proof's
17-ply horizon cannot connect unrelated later play. Same-reply comparisons
can establish that moving Ne4 prevents this mechanism or that another rook
move leaves it available. Failed proofs remain unknown, not proof of a
successful defence. Different-reply causal comparisons remain unimplemented
for this new mechanism.

Twelve regressions cover the source position, mirrored proof, missing
partner pawns, counterpromotion, pinned pseudo-defender, budget isolation,
missed lesson, causal alternatives, board arrows and post-promotion cutoff.
The selected suite passes 367 tests in 33 files, with two opt-in tests skipped;
all fifteen fresh-engine tests pass. The mixed 32-position primary audit
changes only MJZcU, leaving fVRuW, Z5arb, eOCp9 and 4GiqO empty and unresolved.
All 24 ordinary-game headlines and mistake lessons are unchanged, and the
long-mate proof coverage remains 29/32. These are development diagnostics,
not general accuracy. The shared review-worker and production builds pass;
type checking retains the unrelated OTB number/bigint fixture error. Website
primitives, Outpost and live runtimes remain unchanged; no end-to-end UI
latency, deployment or physical board proof is claimed.

## Choice causation and short mating priority (adapter 30)

An audit of the frozen ordinary-game explanations found two concrete errors.
At ordinary-2:ply53, the played Kf1 is exactly Stockfish's best defence, yet
the report said the move was tactically bad because Ncd4 forces mate in three.
The before and after searches happen to show different mating branches;
that cannot make identical positions causally different. The warning and
per-ply mating payoff remain, but the explanation now calls this existing
tactical danger. This rule uses legal reached positions, not equal scores:
the different Kg1 accelerates mate and must not be excused merely because
both mate scores were represented by the same numeric sentinel.

The adapter now derives both reached positions with the same chessops replay
used by its evidence audit. Both legal castling encodings also reach the same
position; a constructed O-O# example exposed the previous parser mismatch
as a false missed-mate claim. Equivalent moves skip unnecessary missed-theme
analysis. All 24 frozen positions pass a counterfactual check in which the
engine's own first move is selected and its own continuation supplied.

At ordinary-1:ply23, Qxc6+ forces mate in three, but the primary missed lesson
was Hanging Piece, and that knight capture inherited the later mate's value.
The existing all-defences checking-mate proof now also nominates short
two/three-move lines. Their initiating check receives the mating lesson;
named patterns remain at their actual terminal plies, and loose-piece
captures retain their immediate exchange values. A legal Nb4xc6 counterexample
rejects a cooperative mate line even though its selected replies still mate.
If an independently proved root mechanism already explains mate, it retains
priority without a redundant generic Forcing Mate badge (ouIHI's discovered
attack/Opera mate regression).

Thirty-two new tests and the updated rook-battery expectation pass within
399 selected tests in 34 files; two opt-in tests are skipped. The frozen
mixed sample changes only Kvpvi's primary anchor to mate in two at Bb4+,
retaining Boden's mate at Bxc3#. Long-mate proof coverage remains 29/32.
The ordinary live headlines remain unchanged; review corrects the Qxc6+
priority and Kf1 accusation above. Shared review-worker and production builds
pass. These remain development diagnostics, not general accuracy or physical
UI proof. No website primitive, Outpost or running-app deployment is included.

All fifteen refreshed Stockfish tests also pass, including the two real-game
before/after explanations above and the updated short rook-battery mate
expectation. Whole-project type checking still reports only the unrelated
`otbGameImport.test.ts` number/bigint fixture mismatch.

## Candidate presentation and board preview

The desktop result view now offers Show on board per tactical candidate.
For the original screenshot, Nxf7 shows the fork's queen/rook targets and
Bxf7+ independently shows weak-f7 evidence. Selection reuses the classified
variation without a new engine search or a game move; overlays never merge
the two choices. Restore main line and scan-change reset keep the overlay
and selected control consistent. The projection does not mutate the cache.

An unclassified principal line with a classified alternative now has a
Tactical alternatives heading instead of a contradictory global empty result.
True abstention says No tactical theme verified and does not rule out deeper
tactics. Conditional engine moves remain inside the existing collapsed
per-ply details rather than also appearing as a long always-visible PV.
Five new DOM/projection tests exercise selection, restoration, reset, real
f7 candidate evidence, non-mutation and the two abstention states. The selected
suite passes 403 tests in 35 files, with three opt-in tests skipped. This does
not change classifier version 30 or its benchmark chess decisions. It is
desktop presentation proof, not a running-app/physical-board check; the phone
review and Outpost surfaces are intentionally untouched in this milestone.

## Proved tactics versus proved causes (adapter 32)

An audit of the real causal benchmark found five root tactics whose explanations
said the move caused them without a successful comparison against the better
choice. A verified tactic is not automatically a verified cause. Uncompared
root tactics now remain visible under Tactic after the move, with an explicit
statement that the better move's effect has not been established. Their motifs
and per-ply evidence are not deleted to create the appearance of better accuracy.

The real Rc5 case now has positive causal evidence. Ra5 keeps the same rook out
of the fork after Rb1+ Kf2, whereas Rc5 permits Nd3+'s king/rook fork. The bounded
comparison tracks target identity through both user choices, finds a legal king
reply, and examines every immediate attacking move. A checking fork, capture of
the named target or immediate mate makes the branch inconclusive. It does not
infer safety from a failed winning search; invalid/exhausted budgets, missing
targets and already-capturing roots cannot prove prevention. This certifies the
absence of this immediate preparation, not every possible longer attack. The
actual Nd3+ still appears at ply 3, not as a premature root-board fork.

Fresh depth-16 before/after searches confirm the Ra5 drawing defence and the
Rc5 rook loss. The causal benchmark now asserts `comparison: prevented` for
this real case. Four other verified motifs still lack a proved causal contrast:
Nd7 after g6, Qf1+ after Re2, Bh7+ after Qxd4, and Ne5 after Nxd4. Their new neutral
wording is an honest limitation, not a claim those moves were good or those
tactics unimportant. See `causal-stockfish-18.json`.

Eleven new tests cover source-independent root inputs, legal escapes, retained
forks, alternate target captures, invalid budgets, missing targets and the real
engine reports. The selected suite passes 434 tests (three opt-in skips), all
sixteen fresh-engine tests pass, and the shared review-worker and application
builds pass. Primary headlines remain unchanged in all 24 ordinary samples,
32 mixed puzzles and twelve earlier puzzles; long-mate coverage remains 29/32.
These source/build improvements do not establish exhaustive accuracy or a
running-app deployment, and website/Outpost delivery remains open.

## Fork severity and causal explanation (adapter 31)

The former immediate comparison treated the same two profitable fork targets
as proof that a tactic was equally costly after both user choices. That misses
a material distinction: a rook can still be forked while being defended, so
losing the exchange is different from losing the whole rook. The existing
all-legal-defences target-capture search now also records its limiting defence
and whether every considered capture leaf resolved. Only complete local
exchange comparisons receive `reduced`; unknown or checking-only proofs do not.
Equal/greater verified gain remains `persists`, and promotion-backed forks
retain their independent proof rather than being reduced to one capture.

The explicit legal diagnostic is
`3qk2r/p1ppppb1/8/4N3/2B5/8/5PPP/6RK b k - 0 1`.
After a6, Nxf7 Qc8 Nxh8 Bxh8 settles at 280 cp of local material gain for White.
After Bh6, the same Qd8/Rh8 fork has no bishop recapture on h8 and its bounded
target-capture proof yields 600 cp. Review now says the move made an existing
tactic more costly, not that it either created the fork or left the same loss.
The visible badge says More costly; an unchanged threat says Existing danger.
The new comparison also survives saved review and per-ply timeline round trips.

This position compares two candidate choices; **a6 is not claimed globally
best**. Fresh independent depth-16 searches choose Nxf7 after both a6 and Bh6,
but give Black +495 and +455 cp respectively. Castling avoids the fork and
scores +585 cp. These full-position evaluations account for compensation and
subsequent play; they are not the local 280/600 cp exchange calculation. Moving
the bishop to f8 instead blocks the king's escape and permits Bxf7#, which
correctly outranks the fork. See `fork-severity-stockfish-18.json`.

Six new regressions cover those local branches, colour-reflected f2 play,
unchanged protection, castling, promotion-backed persistence, wording and
serialization. All 423 selected tests pass (three opt-in skips), all sixteen
fresh-engine tests pass, and both worker/application builds pass. The frozen
24-position ordinary sample, 32-position mixed sample and earlier twelve
puzzles have unchanged primary labels; long-mate proof coverage stays 29/32.
These remain development checks, not exhaustive tactical accuracy. The shared
desktop/phone card adapter and desktop badge are updated in source; no website,
Outpost or running-app deployment is claimed.

Add the following to the fresh-engine benchmark environment to regenerate the
new independent comparison:

```powershell
$env:TACTICAL_FORK_SEVERITY_REPORT = 'benchmarks/tactical-relevance/fork-severity-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'defended and undefended fork'
```

## Bounded background verification

Desktop Tactics now executes classification in a separate module worker instead
of blocking the UI event loop. Each scan owns its worker and terminates it on
success, failure, cancellation or its three-second verification deadline. The
native engine is released before this phase; its existing six-second search
allowance is separate. Failed or timed-out verification is an error with Retry,
never an empty successful scan. The previous synchronous path marked the scan
settled before calling the classifier, so an exception could bypass the failure
handler and leave the spinner indefinitely. Request ownership now lasts through
verification; stale engine responses and cancelled worker results are ignored.

Thirteen tests cover success, abort before/after worker creation, queued stale
results, deadline termination, thrown classifier errors, worker crashes,
structured-transfer failures, unavailable workers, retry, native release and
panel unmount. The initial worker milestone passed 416 selected tests with four opt-in skips.
The production build includes the standalone worker (8,853 application modules).
Type checking retains only the unrelated OTB number/bigint fixture error.

`tacticalBuiltWorker.test.ts` executes the **actual built JS artifact** in a fresh
Node worker per position with only a browser-message bridge, no DOM or Tauri.
All 57 cases (the screenshot's two candidate roots, 24 frozen ordinary-game
positions and 32 frozen mixed-puzzle positions) match source scan objects exactly.
`worker-latency.json` records cold worker import, classification and structured
result transfer on adapter 32: median 57 ms, nearest-rank p95 244 ms, maximum 543 ms. Every case
is below the actual three-second deadline. This is host-local execution/parity
evidence, not WebView scheduling, native-engine search or physical UI proof.
The worker preserves classifier decisions, including its known false negatives.

Reproduce after the production Vite build in PowerShell:

```powershell
$env:TACTICAL_BUILT_WORKER = (Get-ChildItem dist/assets/liveTactics.worker-*.js | Select-Object -First 1).FullName
$env:TACTICAL_WORKER_REPORT = 'benchmarks/tactical-relevance/worker-latency.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalBuiltWorker.test.ts --environment node
```

This execution change applies only to the desktop Tactics panel. Phone review
uses its existing shared review worker; the website and Outpost have their own
execution surfaces. No runtime was restarted or deployed in this milestone.

## Missed opportunities and overlooked threats (2026-09-08)

The review explanation now distinguishes **Missed opportunity** (the user's
better move had the tactic) from **Overlooked threat** (the move allowed a
verified opponent tactic that the better move avoids). Existing danger and
unproved causal comparisons keep their neutral labels. This is explanation
selection and wording, not a new tactical proof or classifier-version change.

A verified immediate missed opportunity no longer loses the main lesson to a
larger opponent motif whose causal comparison is unproved. The explanation can
retain one significant immediate lesson from the other line: it must be at
ply 1, not low-confidence, and have at least 100 cp of locally verified value.
An opponent secondary lesson additionally requires `prevented` or `reduced`
comparison evidence. Later conditional motifs stay in their existing timelines;
they do not become extra causal accusations. Primary ownership stays unchanged
when adding the secondary, including when two sides have the same theme.

`lesson-priority-review.json` records all 32 frozen before/after scenarios,
spanning 17 primary theme IDs. These mix real-game positions, hypothetical
choices in those positions, and constructed controls; they are not 32 new games.
All 32 judged primary themes/owners remain unchanged. Five explanations add a
secondary lesson. In the opGD7-derived Be7 alternative, the primary remains
hanging the bishop to Qxe7, while the text now also explains the missed Qf1+
forcing attack. The queen-sacrificing missed quiet mate still leads with mate,
and separately states the avoidable queen capture. Defender-removal and
intermediate-check examples retain their respective missed capturing defences.
The full evidence text is retained in the report, not just theme agreement.

All 32 colour-reflected controls replay legally and retain their judged theme
and ownership. A pinned-knight opportunity and an unpinned control distinguish
exploiting a real pin from ordinary pawn pressure. Boundary regressions cover
unproved/persistent danger, conditional/low-confidence/minor supporting motifs,
and preventing versus reducing an opponent threat. Before implementation, four
new regressions failed (priority, hidden secondary, perspective, and Be7).
The new suite passes 77 tests including the opt-in report; the broader selected
suite passes 256 tests with three opt-in skips. Fresh depth-16 before/after
searches independently pass the existing 32-case causal-judgement test. Targeted
lint and shared-review-worker/8,854-module production builds pass. The unrelated
OTB number/bigint TypeScript fixture error remains.

Reproduce the frozen audit in PowerShell:

```powershell
$env:TACTICAL_LESSON_REPORT = 'benchmarks/tactical-relevance/lesson-priority-review.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalLessonPriority.test.ts --environment node
```

These are development diagnostics, not general accuracy or newly sampled
holdout evidence. The four previously unproved causal comparisons (Nd7 after
g6, Qf1+ after Re2, Bh7+ after Qxd4, Ne5 after Nxd4) remain explicitly unproved.
Website, Outpost, native ZIP and running services were not deployed/replaced.
No physical UI verification is claimed.

## Adapter 33: capturable attacker as a causal defence

The opGD7-derived Re2 mistake now has a positive causal witness, rather than
being left as an uncompared attack. Re2 permits Qf1+; Kc1 keeps the rook on e1,
so the same Qf1 is not check and Rxf1 captures the queen. The real Bf4+
countercheck is met by Kb1. Qf1+ remains the primary Forcing Attack, with the
actual later pin/fork/capture retained at their plies. This resolves one of the
four unproved comparisons recorded in the preceding milestone.

The general fallback requires a non-capturing, non-promoting reply that is no
longer check after the better move, plus a legal profitable capture of that
attacker. It checks every immediate reply, debits captures/promotions anywhere
on the board, and answers a countercheck with a legal king flight. Every next
reply after that flight must leave local material gain and give no further
check. Recapture exchanges are independently bounded. Missing/illegal captures,
terminal draws, unresolved checking sequences and the 4,096-operation limit
abstain. No PV is used as proof, and a failed attack search is not prevention.
The explanation expressly limits this to refuting the named checking sequence,
not globally proving safety against every future attack. Existing different-reply
comparisons can still override it when the same loss remains proved elsewhere.

Fifteen dedicated tests cover the real root-only and longer-PV inputs, colour
reflection, the actual king flight, invalid/exhausted budgets, illegal pinned
captures, losing recaptures, an off-square queen loss and a legal mate after a
tempting queen capture. The last controls also explicitly replay their alleged
refutations: the checkmate control is `...Qa1 Rxa1 Rh1#`, with the capturer unable
to save its king. This matters because a check with an available interposition
is not checkmate and must not be used as a false oracle.

Fresh Stockfish 18 depth-16 evidence is in
`checking-attacker-escape-stockfish-18.json`: after Re2, Qf1+ scores +614 cp for
Black; the root-restricted Rxf1 after Kc1/Qf1 scores mate in seven for White,
and Kb1 after Bf4+ scores mate in five. These engine mating scores independently
support the chosen defence; the local classifier does not claim to prove those
full mating sequences. The frozen 32-case primary theme/ownership audit remains
unchanged, while Re2 changes from unproved to prevented in the causal comparison.

Reproduce the new independent engine check in PowerShell (use a local engine):

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = '<Stockfish executable>'
$env:TACTICAL_CHECKING_ESCAPE_REPORT = 'benchmarks/tactical-relevance/checking-attacker-escape-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'verify the Re2 checking attack'
```

Adapter/live pipeline 33 invalidates old classifications; the shared review
service was rebuilt. Production builds, the real development HTTP module-graph
regression and all 57 rebuilt-production-worker parity cases pass. These are not
physical UI, website, Outpost or native ZIP delivery claims. The remaining
unproved real causal comparisons are Nd7 after g6, Bh7+ after Qxd4 and Ne5 after
Nxd4; longer forcing defence, other quiet preparations and general accuracy
remain open.

The selected 17-file suite passes 272 tests (two opt-in skips), and both the new
fresh branch test and existing 32-case fresh before/after causal test pass.
Targeted lint passes; TypeScript retains only the unrelated OTB number/bigint
fixture error.

## Adapter 34: defend the remaining threats after removing a discovery

The real Nxd4/Ne5 comparison now has a concrete defence instead of an unproved
causal label. Nxd4 places the knight on the d-file, where Ne5 uncovers Rd8's
attack while also attacking Qd3 and Bc4. Nh4 leaves the d4 pawn in place and
keeps the knight off that ray. After Ne5, Qb3 preserves the queen's defence of
Bc4; Nxc4 Qxc4 no longer permits Rxd4. Nh4 also provides Nxf3 against Nf3+,
and Qb3 can recapture on f3 if the bishop then takes the knight.

Geometry alone is not used as proof. The new comparison requires the original
quiet non-capturing discovery to exist and every revealed ray to disappear
under the alternative. It then searches for a positive quiet defence to the
remaining forcing moves: all legal captures through two recapture rounds,
settled legal-exchange leaves, and checking forks with explicit non-checking
material refutations. Other checking continuations, missing recaptures,
promotions that cannot be met, terminal states and the 8,192-operation budget
abstain. Existing bounded exchange/fork leaves retain their separate bounds.
This is a local causal witness, not exhaustive defence against arbitrary quiet
combinations. Different-reply persistence checks remain in force.

The distinction between Qb3 and Qc3 is important. After the actual Nxd4, Qc3
allows Qxc3 bxc3 Nxc4: an equal queen exchange removes the bishop's defender.
After Nh4 instead, Qc3 is even worse because the retained d4 pawn can take the
queen with dxc3. Both mechanisms are explicitly replayed in the controls; they
must not be confused or inferred from a label.

Fresh depth-16, root-restricted Stockfish evidence in
`discovery-defence-stockfish-18.json` scores Qb3 after Nh4/Ne5 at -19 cp for
White, Qc3 there at -660 cp, and Qb3 after Nxd4/Ne5 at -388 cp. The classifier
does not turn those full-position evaluations into its local material values.
Fifteen dedicated regressions cover original/root-only lines, reflection,
defender exchanges, Nf3+ recaptures, invalid/exhausted budgets, a changed reply
that itself captures a knight, and an extra bishop attack that invalidates the
claimed defence. The original forced discovery still has no certified escape.

Reproduce the independent engine check in PowerShell:

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = '<Stockfish executable>'
$env:TACTICAL_DISCOVERY_DEFENCE_REPORT = 'benchmarks/tactical-relevance/discovery-defence-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'verify the quiet queen defence'
```

The frozen 32-case primary themes and owners remain unchanged; Nxd4's comparison
alone changes from unproved to prevented in `lesson-priority-review.json`.
Adapter/live pipeline 34 invalidates stale classifications, and the shared review
service is rebuilt. The earlier Re2 proof and worker import fix are retained.
Remaining unproved real comparisons: Nd7 after g6 and Bh7+ after Qxd4.

Verification passes 300 selected tests in 19 files (two opt-in skips), the new
fresh branch check, all 32 fresh before/after causal judgements, targeted lint,
shared-review-worker/8,854-module production builds, development HTTP worker
loading and all 57 rebuilt-production-worker parity cases. TypeScript retains
only the unrelated OTB number/bigint fixture error. No native ZIP, website,
Outpost or service deployment, physical UI proof or general accuracy is claimed.

## Countercapture defence comparison (adapter 35; live pipeline 36)

Fresh unrestricted depth-16 MultiPV3 searches now identify the material defence
that the earlier local escape search did not cover. After Bg6/Nd7, Black prefers
Raxa6 (+485 cp from Black's perspective); after g6/Nd7, the best continuation
scores -300 cp. `double-threat-defence-stockfish-18.json` retains all three lines.
Nd7 stops defending Ba6, allowing the rook on a8 to capture it while the rooks
support each other's recaptures. Keeping g7 allows Nf6+ gxf6; moving that pawn
loses the answer to the king/queen fork.

The replay controls preserve an important limitation: Raxa6 bxa6 Rxa6 gives
White a local 70 cp material gain, while Raxa6 Nxb6 Rxb6 gives Black 150 cp.
These are not zero-gain exchanges or the full-position engine evaluations.

The independent countercapture-defence search now retains the initial captured
material through two legal recapture rounds. Non-capturing checks need an actual
non-checking answer whose every recovery capture remains below the combined
100 cp material threshold. This includes recapturing the checking piece's captor,
not just taking named fork victims. A check that no longer forks anything does
not magically erase the attacker's earlier queen/rook sacrifices. The existing
quiet-defence search and its Qb3 discovered-attack witness are unchanged.

The new search has an 8,192-operation budget plus separately bounded exchange
leaves. Invalid/exhausted budgets, unsupported recaptures, checking defensive
replies and unresolved exchange leaves abstain. Terminal states are conservative;
quiet preparations and arbitrary longer checking combinations are outside this
local witness. It does not infer prevention from failure to prove the alternative
attack, and independently verified different-reply persistence still applies.

The displayed witness is Rbxa6, which the local search finds first, not a claim
that it is the strongest defence. Fresh root-restricted searches score Rbxa6 at
+115 cp after Bg6 and -315 cp after g6; unrestricted analysis prefers Raxa6 at
+485 cp after Bg6. The report now explains the material compensation and Nf6+
gxf6 defence. The actual fork remains at ply 3 rather than becoming another root
headline. Only Nd7's causal comparison/text changes in the frozen 32-case audit;
all primary and secondary selections remain unchanged. The unproved-cause
regression now uses the still-unresolved Bh7+ clearance after Qxd4, preserving
neutral wording rather than deleting that safety check.

Seventeen new regressions cover the real comparison, colour reflection,
root-only inputs, budgets, capture credit, missing supporters/targets, pinned
pseudo-defenders, a different valid countercapture when the bishop is removed,
non-fork checks after sacrifices and retained later-ply evidence. All 343 selected
tests pass (two opt-in skips), as do all 32 fresh before/after judgements and the
four-search defence diagnostic. Targeted lint, the shared-review worker and
8,854-module production build pass; the development HTTP worker and all 57
production-worker parity cases pass. TypeScript retains the unrelated OTB
number/bigint fixture error. This is development evidence, not general tactical
accuracy, native deployment or physical UI proof.

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = '<Stockfish executable>'
$env:TACTICAL_DOUBLE_DEFENCE_REPORT = 'benchmarks/tactical-relevance/double-threat-defence-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'inspect defences to Nd7'
node node_modules/vitest/vitest.mjs run src/utils/tests/doubleThreatDefence.test.ts --environment node
```

## Desktop timeout-path verification (live pipeline 35; adapter 34 unchanged)

The reported six-second error occurs before theme verification. The panel used
one deadline for listener registration, cold engine startup and depth search,
and cancellation could call native cleanup before the process was registered.
Remounts also reused per-component numeric request IDs. This revision uses unique
scan IDs and retains a cleanup-only listener after cancellation during startup:
a matching late event proves registration and triggers a second cleanup, never
classification or board updates. A final 35-second cleanup bounds that listener.
The native startup implementation itself is unchanged; this is not a guarantee
against an indefinitely unhealthy native process.

Configured per-scan Threads and Hash are capped at 2 and 64 MB, respectively;
the user's analysis settings and other engine options remain untouched. Cold
startup gets a separate 12-second allowance; the six-second search allowance
begins with the first nonempty snapshot. A depth-8-or-better fallback remains
usable. If only shallow events arrived, `stop` gets 600 ms to flush the newest
unthrottled snapshot. A late stop rejection cannot invalidate verification.
Empty higher-depth events cannot overwrite a usable fallback. Checkmate,
stalemate, insufficient material and invalid setups are handled without a search.
Partial results display actual depth with an incomplete-coverage caveat; genuinely
silent or unusable engines still produce a bounded error, not a false no-tactics
result.

The fresh native test uses the actual capped options against all 24 frozen
ordinary-game positions, 32 mixed puzzle positions and both screenshot positions.
All 58 reached depth 16; the ordinary check-evasion positions with one/two legal
moves correctly supply fewer than three roots. `live-engine-latency.json` records
every run. Usable snapshots took 328 ms median, 365 ms p95 and 475 ms maximum;
total cold-start/search took 597 ms median, 1,198 ms p95 and 1,704 ms maximum.
These measurements exclude Tauri event delivery, worker verification and WebView
rendering; they neither reproduce nor prove the user's physical UI behaviour.

```powershell
$env:TACTICAL_LATENCY_ENGINE = '<Stockfish executable>'
$env:TACTICAL_LATENCY_REPORT = 'benchmarks/tactical-relevance/live-engine-latency.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalEngineLatency.test.ts --environment node
```

Twelve new lifecycle/resource regressions cover startup delay, retained partial
lines, stop flush/rejection, late registration, bounded cleanup, remount isolation,
terminal/invalid positions and non-mutating option caps. The selected suite passes
178 tests (one opt-in skip); targeted lint and the 8,854-module build pass. The
development HTTP worker and all 57 production-worker parity cases also pass.
The classifier and its built worker are unchanged; TypeScript retains only the
unrelated OTB number/bigint fixture error. No app restart, native delivery,
website/Outpost deployment or physical UI verification is claimed.

## What remains to establish

These are relevance milestones, not completion of the broader tuning
goal. Legal exchange analysis validates local material threats and fork
defences; it is not a full tactical search. A forcing episode ends when the
attacking side makes a quiet move without an immediate material threat.
Verified mating preparations and bounded checking attacks containing
PV-nominated quiet moves are now exceptions to that cutoff.
Discovered combinations now have the bounded extra-check proof described above.
Other non-mating quiet preparations, longer mating threats, defensive combinations
and long pawn breakthroughs still need stronger branch evidence. Unproven
zugzwang is withheld because one PV cannot demonstrate its counterfactual.

The next judgement pass must evaluate those false-negative risks, candidate
coverage, and best-move counterfactual evidence beyond immediate replies. Both-side and
repeated-motif rows now have legal per-ply checks, but the primitive detector
and local audit are not an exhaustive search for every possible combination.

The desktop and phone card builder share the new adapter. The website's
vendored v55 primitive detector is unchanged. These are source/build changes;
no running app or hosting deployment is asserted by this report.

## Adapter 40: private easy-course audit and exchange-for-pawn fork

See [private-course-review.md](private-course-review.md) for the output-blind 24-of-222 easy-exercise sample, independent judgements, privacy restrictions and unresolved failures. Source PGNs, complete sampled positions and detailed engine reports must remain outside this repository.

The first implementation slice recovers a genuine fork missed by both the generic 100 cp gate and an immediate-only defensive probe. A complete major-piece fork proof can now retain an exchange-for-pawn gain and independently verify a checking mate after a defender captures the forker. This is bounded to non-capturing minor-piece forks, complete exchange leaves and at most four checking attacking moves under a shared 4,096-move mating budget. Other motif thresholds/horizons are unchanged. Countercaptures, actual mating escapes, missing support, smaller-budget cache isolation, colour reflection, missed opportunities, existing danger, board arrows and conditional later mate are tested.

One private headline is recovered; ten of the 24 remain empty, with other priority/preparation questions explicitly open. The old 82 worker headlines and 32-case lesson report remain unchanged. The 436-test selection, fresh private five-search diagnostic, 24-position engine replay, 84-case built-worker audit plus private worker case, isolated HTTP worker and production/shared worker builds pass. This is source/build evidence, not native deployment, physical UI verification or completion of the broader goal.

## Adapter 41: pinned-defender captures with compensation

The next private easy-course miss is recovered as a capture exploiting a pin, with the alternative rook recapture and related rook payoff explicitly explained. A 4,096-move bounded capture/flight audit accounts for immediate off-square liabilities and mate, without searching arbitrary quiet combinations. Its recapture counterfactual guards against removing real support or exposing the capturing side's king. Incidental pins cannot borrow a directly won queen's value; genuine dependent queen captures remain pins. See [private-course-review.md](private-course-review.md) for limits, private reproduction and the five fresh Stockfish checks.

The fixed private sample now has nine empty headlines; this does not imply the other fifteen are all correct. The old 84 production-worker headlines and 32-case lesson report are unchanged. Ten new tests pass within 446 selected regressions; the fresh private replay/branch checks, 85-case public worker audit plus two private cases, isolated HTTP worker and builds pass. Broader preparation/missed-opponent causation, rare-theme coverage and native runtime verification remain open.

## Adapter 42: sacrifice before the checking fork

Checking captures that attract the king to a subsequent fork now have independent root evidence: every acceptance/decline branch must preserve a local material gain, with sacrifice and recapture costs included. The primary is Fork Preparation; the actual fork stays at its reached ply, and incidental attacked pieces are omitted from the recovery explanation. Missed opportunities share this root lesson; a demonstrated opponent mating threat still outranks it. This bounded proof does not cover quiet offers, arbitrary later checks or general before/better opponent causation.

See [private-course-review.md](private-course-review.md) for the eleven fresh engine searches, limitations, private reproduction and a correction to earlier count wording: adapter 41 and 42 both have nine empty **source-line** results and eight empty **live main** results. Two private primary explanations improve; the other 22 are unchanged. Verification includes 459 selected tests, 86 public plus four private actual-controller worker cases, isolated HTTP execution and production/shared builds. No native deployment or physical UI proof is claimed.

## Adapter 43: compensation-aware recapture labels

Accepting a proved sacrifice no longer receives a misleading Winning Recapture badge when its gain is refuted by a verified fork preparation, pinned-capture compensation, defender removal or immediate mate. The move itself and actual later tactics remain visible. Trusted prior-move replay is required; unsound sacrifices, missing recovery pieces and genuine profitable recaptures retain their material lessons. Three private timelines improve while every live primary remains unchanged. See [private-course-review.md](private-course-review.md) for the fresh engine branches and limits. Verification covers 492 selected tests, 88 public plus four private production-worker cases, isolated HTTP execution and builds, not deployment or physical UI interaction.
