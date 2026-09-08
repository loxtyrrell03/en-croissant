# Tactical relevance judgement, 2026-09-08

This evaluates the lesson shown for a position, rather than agreement with a
puzzle's complete tag set. Positions and expected lessons were chosen before
the new relevance filter. Stockfish 18 searched each position afresh at depth
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

`causal-stockfish-18.json` adds fresh searches before and after three mistakes,
with all three engine candidates and the resulting explanations:

| Mistake | Engine's better move | Judged causal lesson |
| --- | --- | --- |
| Black plays b6 in the screenshot position | O-O | Allows Nxf7; castling removes the profitable queen/rook fork |
| White plays Kb1 with a loose black queen and attacked white knight | Nxe4 | Misses winning the queen while saving the knight |
| Black plays b6 facing Re8# | g5 | Allows back-rank mate; g5 supplies Kg7 after Re8+ |

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

Run in PowerShell with the configured Node runtime on PATH:

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = 'absolute path to a local Stockfish executable'
$env:TACTICAL_JUDGEMENT_REPORT = 'benchmarks/tactical-relevance/stockfish-18.json'
$env:TACTICAL_CAUSAL_REPORT = 'benchmarks/tactical-relevance/causal-stockfish-18.json'
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
This intentionally excludes speculative tails, but quiet preparatory moves,
pure mate threats, defensive combinations and long pawn breakthroughs need
stronger branch evidence before they can be admitted reliably. Unproven
zugzwang is withheld because one PV cannot demonstrate its counterfactual.

The next judgement pass must evaluate those false-negative risks and deepen
best-move counterfactual evidence beyond immediate replies. Both-side and
repeated-motif rows now have legal per-ply checks, but the primitive detector
and local audit are not an exhaustive search for every possible combination.

The desktop and phone card builder share the new adapter. The website's
vendored v55 primitive detector is unchanged. These are source/build changes;
no running app or hosting deployment is asserted by this report.
