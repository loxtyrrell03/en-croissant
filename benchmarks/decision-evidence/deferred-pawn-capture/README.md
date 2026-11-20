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
