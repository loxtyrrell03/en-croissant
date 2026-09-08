# Adjacent ordinary-game audit (adapter 39)

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
| ordinary-1:ply39 | Bxg5+ uncovers Rf8 against Qa8 while checking Kc1; Rxa8 is a real payoff. Adapter 38 verifies that Ng5 makes this existing attack more costly: Nd4 still permits Bg5+, but hxg5 limits the local exchange to 570 cp instead of 890. This is not a newly created discovery. |
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
| ordinary-3:ply24 | **Open root:** Bb3 protects the bishop while retaining the diagonal towards Qf7/Kg8 and supports the later Nc7/rook gain. Quiet defensive alternatives are not yet proved. Adapter 39 fixes the reached Nxc7 position: its larger joint discovered attack on queen/rook leads over the smaller trapped-rook consequence, with both arrows. Fresh engine checks reject immediate Nxc7 before protecting the bishop. The Kh8/Nxc7 branch does not itself prove Bb3 against every defence. |
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

### Adapter 38: existing checking discovery made more costly

Before Ng5: `Q2b1rk1/p1p2ppp/1p1p4/3N4/7P/5NPB/PPP1P3/2KR4 w - - 1 20`.
Both Nd4 and Ng5 permit the same bishop move uncovering Rf8 against Qa8.
Ng5 additionally offers the knight: `Bxg5+ hxg5 Rxa8` gains 890 cp locally,
whereas `Bg5+ hxg5 Rxa8` after Nd4 gains 570. Review now says **More costly**,
retains the discovered-attack lesson and names the actual legal limiting reply.

The comparison requires identical revealed rays, targets and attacking mover,
and completed immediate exchange leaves against every legal defence on both
sides of the comparison. Extended lower bounds, promotions, changed victims,
user-move captures and unresolved exchanges cannot certify reduced severity.
Equal or larger alternative gains remain existing danger. Quiet-discovery
defences and other causal mechanisms are unchanged.

`discovery-severity-stockfish-18.json` contains four fresh depth-16 searches.
Unrestricted Stockfish chooses Bg5+ after Nd4 (-890 cp for Black) and Bxg5+
after Ng5 (-749). Root-restricted scores are -867 and -746 respectively.
The full-position difference of 121 cp is not the local exchange difference
of 320 cp; White remains ahead in both positions. The frozen audit's older
Nd4/Re8 PV is retained as provenance, not asserted to remain the best reply.

Nine new regressions cover the real exchange, legal reflection, unchanged
severity, removal of the recapturing pawn, missing/changed queen, best-move
non-accusation and root-only/full-line agreement. The 403-test selection,
all 32 fresh before/after judgements, four new engine searches, 81 built-worker
parity cases, development HTTP worker execution and both production builds
pass. The earlier 32-case lesson report is unchanged. TypeScript retains only
the unrelated OTB number/bigint fixture error. This is bounded development
evidence, not general accuracy or physical UI proof.

Reproduce with `TACTICAL_JUDGEMENT_ENGINE` and
`TACTICAL_DISCOVERY_SEVERITY_REPORT`, selecting `inspect the existing checking
discovery` in `tacticalJudgement.test.ts` with `--environment node`.

### Original audit and current replay

The adapter-39 follow-up is recorded in `discovery-priority-stockfish-18.json`.
Set `TACTICAL_DISCOVERY_PRIORITY_REPORT` and select `inspect the protected bishop`
in `tacticalJudgement.test.ts` for the five fresh restricted/unrestricted searches.
Production worker coverage now includes the reached protected-discovery position
as an 82nd case. Its 600 cp immediate local proof does not account for arbitrary
later quiet manoeuvres; the full Stockfish continuation/evaluation is separate.

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
