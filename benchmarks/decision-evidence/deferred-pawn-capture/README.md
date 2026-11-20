# Taking a loose pawn versus finding a tactic

The original local proof correctly identifies that 47.Kxg4 takes a loose
pawn in the annotated ending. Decision Evidence treated that observation
as sufficient evidence of a tactical decision. The same legal capture
appears after 47.Bb2 Rd7 48.Bc4 Nc6 in a still-winning engine line.
The immediate capture also leaves Black with an isolated h-pawn. Keep
the exact material fact separate from the question about tactical demand.

Compare the current assistant with two conservative alternatives. Both
use same-depth finite scores in which the capture and another quiet move
score at least +3.00 for the mover and differ by at most 1.50 pawns. The
first trial uses just those scores and a single directly undefended pawn.
The second also requires the same piece to take the same pawn later,
without either piece having moved, in the alternative's first ten plies.
Taking the pawn must remain a nonchecking, undefended capture. These
are screens for one local proof, with genuine combinations and defensive
resources still evaluated independently. Evaluation thresholds define
the comparison sample. They are not a chess proof of a won position.

## Frozen transfer

One position per game is frozen from explicitly classical public
broadcasts. The 32 taken cases show an immediate recorded capture.
The 32 deferred cases show it later in the recorded game. That move
only samples a shape. The evaluation compares new legal Stockfish 19
frames without assuming the played move is good. The root search uses
2.4M nodes and three choices. A separate frame uses 5.4M nodes and
four choices, with independently searched replies for review. Separate
the evaluation of the exact capture from the position and actual
mistake. Include the previously reviewed genuine pawn tactics as
safety controls. The transfer cases do not include their games or
other boards already seen in the related development cohorts.

## Results

The independent search supports seven exact deferred captures in six
games. The remaining cases are unresolved for this specific question.
Two of the seven appeared in the same app-budget continuation. Both
previously supplied a tactical label based only on the loose pawn.
The stricter comparison removes those two certificates. In the Turkish
league, `h3 Nd5 Qxa3` still takes the pawn on a3. In Davoine, a knight
manoeuvre after `Nh3` leaves the bishop free to take h4. The deeper
search sees a different knight manoeuvre before the same capture.
[Turkish league game](https://lichess.org/broadcast/2026-turkiye-satranc-ligi-turkish-league-super-lig/round-12/A84qp8J6/F0CDb4yY) ·
[Davoine game](https://lichess.org/broadcast/40e-open-international-davoine/round-3/kqVNSbC7/9QWJoM59)

The score-only comparison would remove four certificates. Three have
the same independently observed deferral and one remains unresolved.
The exact-move screen requires the capture to recur in its alternative
line. The enriched transfer measures agreement on that specific
observation.

In 1,367 matched replays, four candidate reports and their position
summaries change. Two are in the fresh sample. In the earlier data,
`Kxg4` becomes positional and `Nxc5`, whose tactical reference was
unresolved, becomes unclear. No reviewed tactical positive or actual
mistake changes. The 1,051 archive and 124 course, puzzle and private
classical requests have identical reports apart from the version.
The worker median is about 76 ms in both matched runs. The comparison
reuses existing legal lines and requests zero extra engine searches.
At the lightest search tier, the original Candidates
example may lack the exact deferral. The rule then abstains from
requalifying the capture.
[Matched replay and exact lines](results.json)

The isolated Windows build shows the exact `h3 Qd8 Qxa3` line
using live Stockfish 19 at its normal search budget. The mixed queen
fork and castling-delay checks also pass on that build.
[Windows smoke result](windows.json)

Run `classical-frames.py` from the broad audit with `transfer.json`
at the app and reference budgets. Use `readback.py REFERENCE_FRAMES OUTPUT`
to inspect the legal lines, then replay the same app frames on both
workers with the broad audit's `replay.config.mjs`. Prefix the input
IDs by cohort when combining sets. Run `score.py` with the matching
replay outputs and the frozen [reference](reference.json).
