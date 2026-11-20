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

Missing pawn links and clearly inferior checking routes provide
negative controls. Confounding material swings and incomplete or
inconsistent searches remain unresolved. Reference labels
describe whether the exact evidence is present at the higher
budget. They cannot determine how much of an evaluation difference
comes from the pawn structure. The original classifier's position,
move and mistake results stay separate.

## Development revision

The first material comparison stopped after six plies. In the
Candidates calibration it stopped on `Nxc6` in the direct-capture
line. The very next move, `...Rxc6`, completes the exchange. The
revised comparison follows up to two recorded recaptures on the
same landing square at the cutoff, stopping before unrelated moves.
The original pawn link must last through any extension in its branch.
Both fixed and settled candidates are scored on the same reference.
The Candidates example becomes verifiable after settlement. The
variant was fixed before looking at reserve outcomes.

## Results and app integration

| Exact mechanism | 35 development games | 47 reserve games |
| --- | ---: | ---: |
| Deeper verified positives | 0 | 1 |
| Deeper verified negatives | 29 | 34 |
| Unresolved references | 6 | 12 |
| Existing v63 verified positive explanations | 0 | 0 |
| Root pattern hits, including negatives and unknowns | 1 | 6 |
| Cached verification with no extra replies | 0 | 0 |
| Verified explanations with targeted reply | 0 | 1 |

The root pattern selects one true positive, three known negatives
and two uncertain cases in reserve. The verified approach finds the
same positive and makes no claim on the other five. The reserve case
is `...Qd4+ Kh1 Qxd5` in the European Club Cup. Black retains the
b7–c6 pawn link. The alternatives after `...cxd5` include `Qxf7`,
and Black has moved the c6 pawn. The check is already a verified fork
in v63. A restricted replay confirms the new structural comparison.
[Game](https://lichess.org/broadcast/41st-european-chess-club-cup-2026-open/round-2/ETE9LeyG/fVYl3mxV)

In a German Championship control, `Nf7+ Ke7 Nxe5` also
takes the same piece that a pawn could capture. The subsequent
`...Nxc3` removes the c3 pawn within the comparison window. The
pattern calls it a retained chain and the verifier correctly abstains.
Two other root pattern hits remain unresolved because the routes
change material by too much to isolate the structural comparison.
[German Championship game](https://lichess.org/broadcast/german-chess-championship-2026-masters-men/round-5/yzzoZ1jd/CtCWBKgi)

Decision Evidence v64 requires the checking move to be first in the
normal shortlist, with an independently supported tactic. The pawn
capture must already be scored in the same shortlist. It reuses
existing replies or adds one search after the pawn capture, capped at
1.4M nodes and 3.6 seconds inside the analysis deadline. The resulting
strategic interpretation and both legal lines appear in the position
and candidate-move summaries. The mistake report uses its own input.

On 210 matched worker requests, the shipped policy nominates four
additional replies. Two lead to mixed explanations, one in
calibration and one in the reserve. Nothing else changes besides the
report version. There are no new nominations on the other 127
previously reviewed decisions. A source-built browser panel showed
both explanations on the Club Cup board at 320, 390 and 900 pixels.
The single independent positive limits inference about more general
mixed-classification accuracy. [Results and exact board evidence](results.json)

The isolated Windows build at `7a11ac6a` reproduced both mixed
diagnoses with live Stockfish 19. The full analysis took 6.6
seconds on the Candidates board and 7.3 seconds on the Club Cup
board in this test. The earlier `h4` played-move regression also
passed. The installed app and phone service are outside this
verification. [Windows receipt](windows.json)

On the earlier Candidates review, this changes one of seven mixed
position references and one of two mixed exact-move references from
missed to detected. That example informed development of the new
test. The other six mixed positions remain unexplained. This
readback is separate from the game-disjoint reserve above.

## Reproduce

Use `capture.py STAGE INPUT STOCKFISH OUTPUT --split SPLIT` for both
stages. The checked-in `transfer.json` contains development and
reserve, and `calibration.json` contains the opened Candidates board.
The Stockfish 19 executable has SHA-256
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.
The app stage preserves the normal three root choices and records the
extra comparisons. The reference stage clears the engine hash for
each request and captures its own lines. Run
`assess.py APP_FRAMES REFERENCE_FRAMES OUTPUT` to compare the methods.
`test_assess.py` covers the legal interposition, pawn support and
connected recapture on c6.

The worker replay uses `replay.config.mjs`,
`CAPTURE_ROUTE_INPUT` and `CAPTURE_ROUTE_OUTPUT`. The input is
the concatenated app-frame lists, tagged with their cohort. Keep
the calibration row when it also appears in the wider archive. Pin
`DECISION_AUDIT_REVISION` to the revision being replayed and set
`CAPTURE_ROUTE_CANDIDATE=1` when replaying v64. Use the standard
source-panel harness for `verify-panel.mjs`. `receipt.py --help`
lists the input order for the compact release report.
