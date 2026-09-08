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

`causal-stockfish-18.json` adds fresh searches before and after four mistakes,
with all three engine candidates and the resulting explanations:

| Mistake | Engine's better move | Judged causal lesson |
| --- | --- | --- |
| Black plays b6 in the screenshot position | O-O | Allows Nxf7; castling removes the profitable queen/rook fork |
| White plays Kb1 with a loose black queen and attacked white knight | Nxe4 | Misses winning the queen while saving the knight |
| Black plays b6 facing Re8# | g5 | Allows back-rank mate; g5 supplies Kg7 after Re8+ |
| White plays Ke5 with the queen attacked in the quiet-mate example | Qh2 | The main missed opportunity is forced mate, ahead of the allowed queen loss |

The final position is already materially lost: this judges avoidance of
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

`material-stockfish-18.json` records five additional candidate judgements. Each
has a fresh unrestricted depth-16/MultiPV3 search and a separate search
restricted to the move being judged, so the refutation is engine-selected:

| Candidate | Judged lesson | Observed defence/payoff |
| --- | --- | --- |
| d6 attacks Ne7 pinned by Re1 to Ke8 | Pin, not generic piece pressure | The king moves and dxe7 wins the knight |
| Same d6 with an enemy rook on a6 | No claimed pin win | Rxd6 takes the attacking pawn |
| Bd3+ lines up Kf5 and Qh7 | Skewer | The king moves and Bxh7 takes the queen |
| Same Bd3+ with an enemy pawn on e5 | No claimed skewer win | e4 blocks the bishop's line |
| exf6+ captures the knight defending Qd5 | Removing the Defender | A king reply permits Rxd5 without the knight's recapture |

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

Run in PowerShell with the configured Node runtime on PATH:

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = 'absolute path to a local Stockfish executable'
$env:TACTICAL_JUDGEMENT_REPORT = 'benchmarks/tactical-relevance/stockfish-18.json'
$env:TACTICAL_CAUSAL_REPORT = 'benchmarks/tactical-relevance/causal-stockfish-18.json'
$env:TACTICAL_QUIET_REPORT = 'benchmarks/tactical-relevance/quiet-stockfish-18.json'
$env:TACTICAL_MATERIAL_REPORT = 'benchmarks/tactical-relevance/material-stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node
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
Non-mating quiet preparations, longer mating threats, defensive combinations
and long pawn breakthroughs still need stronger branch evidence. Unproven
zugzwang is withheld because one PV cannot demonstrate its counterfactual.

The next judgement pass must evaluate those false-negative risks, candidate
coverage, and best-move counterfactual evidence beyond immediate replies. Both-side and
repeated-motif rows now have legal per-ply checks, but the primitive detector
and local audit are not an exhaustive search for every possible combination.

The desktop and phone card builder share the new adapter. The website's
vendored v55 primitive detector is unchanged. These are source/build changes;
no running app or hosting deployment is asserted by this report.
