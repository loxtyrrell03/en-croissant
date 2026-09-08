# Adjacent ordinary-game audit (adapter 37)

Selection was fixed before inspecting output: use the same three complete
frozen game mainlines, but reached plies 9, 14, 19, ... through 59, skipping
terminal positions. This gives 24 positions disjoint from the original
8, 13, 18, ... sample. These are **not 24 new games or an independent holdout**:
the surrounding games were already used for development. The source archive,
game URLs and source hash remain in `ordinary-games-development.json`.

`ordinary-adjacent-stockfish-18.json` is the original frozen audit: 48 unique
before/after FENs, fresh Stockfish 18 depth-16 MultiPV3/Threads1/Hash32 searches,
actual previous-move context, and the pre-fix adapter-36 outputs. Do not
overwrite it during routine verification. `ordinary-adjacent-review.json`
records the current classifier outputs against those same engine lines.
Mate-transition `cpLoss` values use a sentinel, not literal centipawn losses.

## Chess judgements

An empty headline means no verified immediate motif in the bounded line,
not no advantage or no possible tactic. In particular, the two explicitly
open cases below must not become successful empty-result assertions.

| Sample | Inspection |
| --- | --- |
| ordinary-1:ply9 | Be7 is development after Bg5; no discrete tactical win demonstrated. |
| ordinary-1:ply14 | e4 develops the centre after Nc6; ordinary play. |
| ordinary-1:ply19 | Nb4 gains a queen tempo, but does not force a material fork; Qxa6 was also the prior best move. |
| ordinary-1:ply24 | Qxc6+ forces mate in three. It outranks the loose knight and rook captures; Nxf2 allowed it, whereas b5 blocks the queen's route. |
| ordinary-1:ply29 | Black's Nd3+ is a defensive continuation. The actual missed lesson is White's Qxd8# instead of Bxd8. |
| ordinary-1:ply34 | Qc6+ continues the attack with a large material lead. The current short line does not establish an additional named root mechanism. |
| ordinary-1:ply39 | Bxg5+ uncovers Rf8 against Qa8 while checking Kc1; Rxa8 is a real payoff. Ng5 worsens the position, but the local comparison against Nd4 remains unproved, so review stays neutral about causation. |
| ordinary-1:ply44 | Rf1 is ordinary continuation; the earlier pawn capture is not a tactical combination. |
| ordinary-2:ply9 | Ng8 answers the pawn attack after best-move e5; no tactical headline. |
| ordinary-2:ply14 | Qh5+ starts a verified forcing attack. Its actual queen-for-bishop recapture was wrongly hidden; fixed below. The later Qxb7 rook trap is conditional, not the root mechanism. The comparison against Ne7 remains unproved. |
| ordinary-2:ply19 | Black's Qxf6 is a pawn capture. White missed f7+'s verified mate-in-seven attack by choosing Bc4. |
| ordinary-2:ply24 | Qd4 is a quiet continuation after the knight recapture, not a proved tactical root. |
| ordinary-2:ply29 | h6 attacks the bishop with a pawn; Bxd5 was also the previous best move. No immediate named win is established. |
| ordinary-2:ply34 | Ne2 develops/coordinates the knight; no root material combination demonstrated. |
| ordinary-2:ply39 | **Open:** Bb5+ begins a much longer king drive; its +1185 cp evaluation is not a bounded proof. The simpler Qxg2+ alternative wins material but must not be transplanted onto Bb5+. |
| ordinary-2:ply44 | Nc5 is a quiet knight move; Kf7 was also the previous best defence. |
| ordinary-2:ply49 | Rd8 is a rook continuation after best-move Nxa4. Do not relabel the later rook exchanges as new hung pieces. |
| ordinary-2:ply54 | White's Nc3 is a desperate defence in a mating position; it is not a missed winning tactic or a newly caused mating loss. |
| ordinary-2:ply59 | Rxg2# is immediate mate. Kg1 was exactly the best defence, so the danger is existing, not a mistake caused by that choice. |
| ordinary-3:ply9 | d5 is central development after Bg5; no immediate material tactic demonstrated. |
| ordinary-3:ply14 | e4 is ordinary development after the compensated bishop/knight exchange. |
| ordinary-3:ply19 | Nd7 develops after best-move Nxg5 already won a bishop. |
| ordinary-3:ply24 | **Open:** Bb3 protects the bishop while retaining the diagonal towards Qf7/Kg8 and supports the later Nc7/rook gain. Quiet defensive alternatives and the pinned-queen mechanism are not yet proved by this classifier. The engine's Kh8/Nxc7/Qg7/Nxa8 branch is not itself an all-defences proof. |
| ordinary-3:ply29 | Kxf7 recaptures the bishop after Bxf7+ won the queen; it is not a newly hung bishop. |

## Fix: profitable recaptures versus exchange noise

The actual attack line is `Qh5+ g6 Bc4+ d5 Bxd5+ Qxd5 Qxd5+ Be6 Qxb7`.
The old same-square filter removed every recapture from the timeline, including
the queen-for-bishop payoff at ply 7, then displayed the later rook trap at 9.

A recapture of a piece that itself just captured is now retained only when its
settled exchange gain, minus that immediately preceding loss, is at least
100 cp. The display says **Winning Recapture**, names both traded pieces and
uses the net local material value: 570 cp for queen minus bishop, not 900 cp.
The same replay-validated history applies when the user views the payoff as a
new root. Routine compensated exchanges remain hidden; the prior suppression
of captures of quiet offers inside a combination is unchanged. Promotion
accounting is not inferred by this new annotation.

Constructed controls cover a 170 cp rook-for-bishop gain and a queen-for-rook-
and-bishop exchange worth only 70 cp after the capturing rook is recaptured.
The latter must not become a newly won queen or 400 cp exchange. Reflection,
root/timeline agreement and rendered ply-7 wording are tested. No other primary
label or primary-line timeline changes in this 24-position sample; the previous
32-case mistake-priority report is unchanged. Original unknown causal comparisons
remain unknown. These are development findings, not general accuracy claims.

## Reproduction

To intentionally create a separate fresh engine audit, set
`TACTICAL_JUDGEMENT_ENGINE` and `TACTICAL_ORDINARY_ADJACENT_REPORT` to a new report
path, then run the `audit an output-blind longitudinal` test in
`src/utils/tests/tacticalJudgement.test.ts` with `--environment node`.
Do not pass the original fixture path when only verifying current source.

For replay-only current output, set `TACTICAL_ADJACENT_REVIEW_REPORT` and run
`src/utils/tests/ordinaryAdjacentJudgement.test.ts`. The production-worker audit
now includes all 24 adjacent positions as well, for 81 total cases. Worker
timing excludes native engine search and does not prove WebView/physical UI
latency. Native packages, websites, Outpost and active sessions were not replaced
or restarted for this milestone.
