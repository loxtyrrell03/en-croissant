# Tactical relevance judgement, 2026-09-08

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
| 2SvDe | Spurious clearance removed. The Bxd2+ / Rxh8 intermediate-capture explanation still needs improvement. |
| 9THyd | Spurious clearance removed. Nxe7+ before fxe3 still needs a better timing explanation than two loose-piece labels. |
| 2Gc77 | Bxd5 now prioritizes defender removal, with the simultaneous Bb7 attack and Rd8 behind Ne7 explaining different defences. |
| 8DHuj | False clearance removed, but Bxf4's actual removal/overload combination remains missed. |
| 4RNK5 | Open false negative: quiet Rb6 prepares Rh7+ and a queen-winning Rb7+ skewer. |
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

Current verification: 202 focused tests in 21 files, all nine opt-in engine
tests (including the existing real-game audit), targeted formatting/lint,
shared-review worker and production builds passed. Type checking still reports
only the existing OTB number/bigint fixture error. No application restart,
runtime deployment or physical UI verification was performed.

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
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node
$env:TACTICAL_REAL_PUZZLE_REPORT = 'benchmarks/tactical-relevance/real-puzzle-judgement.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/realPuzzleJudgement.test.ts --environment node
```

The engine test is opt-in and starts no engine during normal unit tests.
`causalTactics.test.ts` separately checks poisoned f7 captures, a capturable
geometric fork, a truncated refutation, equal queen exchanges, illegal PV
boundaries, losing alternatives, and the priority of missed mate over a smaller
allowed material loss. Existing tests retain the multi-step rook fork and pin.

## What remains to establish

These are relevance milestones, not completion of the broader tuning
goal. Legal exchange analysis validates local material threats and fork
defences; it is not a full tactical search. A forcing episode ends when the
attacking side makes a quiet move without an immediate material threat.
Verified short mating preparations are now an exception to that cutoff.
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
