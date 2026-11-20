# Taking the same piece without breaking a pawn chain

In the Candidates position with `...Ne7+`, a knight can take the d5
rook after the discovered check. `...exd5` takes the same rook
immediately, but uses the e6 pawn that supports f5. The stronger line
keeps that support through the capture and the next exchanges. In the
leading continuation the e6 pawn is eventually taken. This is a
specific, finite structural difference.
[Candidates analysis](../annotation-transfer/README.md)

This benchmark tests whether that idea transfers to other games. The
recorded-move test freezes decisions where a non-capturing piece check
is followed by a piece capturing an original enemy unit which a pawn
could have taken immediately. The converse sample starts with a
recorded pawn capture and a legal checking route to the original
target after at least one reply. These are challenge populations.
One decision per game and colour-normalised board is selected before
looking at new engine scores. The reserve excludes tournament families
from the 2025 development sample. The already-open Candidates case
supplies calibration only.

Both the tactical mechanism and structural purpose require
observations. The tactical comparison follows the same original
captured piece through the opponent's move. The positional comparison
follows an original pair of pawns that defend one another in at least
one direction, including through the next exchanges. It tests whether
the pawn capture breaks that specific connection. Both captures can be
legal and the comparison can still remain unresolved when the check
changes what else is won or lost.

## Fixed comparison before scoring

The simple candidate tests check-then-capture in the leading root
variation, selecting only a check already in the normal three lines.
The cached candidate tests the exact original target and original
pawn link in root and independent reply frames. It uses the normal
candidate and reply search budgets. A third arm can request a 1.4M-node
paired search if the immediate capture is outside the shortlist, plus
independent reply frames for missing choices. The paired direct capture
is legal on the original board. The additional searches and number of
requests are measured separately.

The independent reference uses a 6M-node general root search, up to
4.8M nodes per restricted comparison and 3.2M nodes per independent
reply search. It checks the root and child exact choices. Both must
favour the check by at least 40 centipawns, or both must favour the
pawn capture by at least 40 centipawns for a score-based negative.
To be a positive the check also has to stay within 35 centipawns of
the general root lead and expose the same original piece to capture
by the next friendly turn in principal lines. Independent opponent
replies within 35 centipawns of the best reply must agree on the
original target. Both branches need six legal plies, with at most one
pawn in material difference. The original pawn support has to persist
for those six plies in the check line and disappear in the pawn line.
Different proven pawn alternatives may be counted separately in the
audit, but each decision has one outcome in the summary.

Check only cases and known material failures are controls. Incomplete
or inconsistent searches remain unresolved. Reference labels
describe whether the exact evidence is present at the higher
budget. They cannot determine how much of an evaluation difference
comes from the pawn structure. The original classifier's position,
move and mistake results stay separate.
