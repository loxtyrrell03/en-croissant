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
fresh engine candidates (including excluded ones), retained line themes, and
classification time. It is evidence for these positions, not an accuracy
estimate for all chess. Engine timing varies with other work on this PC.

Run in PowerShell with the configured Node runtime on PATH:

```powershell
$env:TACTICAL_JUDGEMENT_ENGINE = 'absolute path to a local Stockfish executable'
$env:TACTICAL_JUDGEMENT_REPORT = 'benchmarks/tactical-relevance/stockfish-18.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node
```

The engine test is opt-in and starts no engine during normal unit tests.
`causalTactics.test.ts` separately checks poisoned f7 captures, a capturable
geometric fork, a truncated refutation, equal queen exchanges, illegal PV
boundaries, losing alternatives, and the priority of missed mate over a smaller
allowed material loss. Existing tests retain the multi-step rook fork and pin.

## What remains to establish

This is the first relevance milestone, not completion of the broader tuning
goal. Legal exchange analysis validates local material threats and fork
defences; it is not a full tactical search. A forcing episode ends when the
attacking side makes a quiet move without an immediate material threat.
This intentionally excludes speculative tails, but quiet preparatory moves,
pure mate threats, defensive combinations and long pawn breakthroughs need
stronger branch evidence before they can be admitted reliably. Unproven
zugzwang is withheld because one PV cannot demonstrate its counterfactual.

The next judgement pass must evaluate those false-negative risks, compare
the refutation against what the best move actually prevents, and validate
repeated motifs/opponent counter-tactics at their individual plies. Current
continuation rows retain the classifier's mapped occurrences; they do not yet
constitute a fresh all-themes classification of both sides on every ply.

The desktop and phone card builder share the new adapter. The website's
vendored v55 primitive detector is unchanged. These are source/build changes;
no running app or hosting deployment is asserted by this report.
