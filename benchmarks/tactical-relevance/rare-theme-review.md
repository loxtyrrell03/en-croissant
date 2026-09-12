# Rare-theme real-game review — adapter 81 / live pipeline 86

## Scope and method

The fixed [20-position sample](rare-theme-development.json) covers interference, zugzwang, deflection, trapped pieces and clearance: four development rows per supplied theme, with distinct source games, ordered by a recorded SHA-256 salt before classification. Four IDs already appeared in older local artifacts; this is a development set, not a held-out accuracy estimate. The source is the locally downloaded CC0 Lichess fixture, not newly downloaded puzzles. Its exact SHA-256 is recorded in the [53-search Stockfish report](rare-theme-stockfish-18.json).

Initial human notes were written before the adapter-80 replay. They are hypotheses, not labels to make the tests satisfy. Fifty-three fresh depth-16 searches check both unrestricted and source-root play, selected defensive branches, and explicitly marked pass counterfactuals. Centipawns are from the current side to move. A local material certificate is not the full engine evaluation, and a changed turn is not a legal played variation.

## Changes supported by the chess

- **zYjb5 — forced interference.** Qc6+ forces Kd3, which cuts Qd1 off from Rd7. The main lesson is now Forced Interference, rather than a generic Forcing Attack. Kd3 gets a secondary Self-Interference entry at ply 2; Qxd7+ remains the payoff at ply 3. The local bound is 400 cp, not 500: Kxc3 can take a pawn while escaping the capture's check. Stockfish gives the root +430/+464 cp White in the two fresh searches. An extra rook defender refutes Qxd7+; a constructed additional king flight prevents claiming that the interference is forced.
- **om0GQ — mating king deflection.** The forced mate remains primary. Rg7+ now explains, at ply 3, why the king must abandon h6 before Rxh6#. The verifier checks every legal reply and independently verifies the mating capture. The premature Rxh6+ allows Kxh6 and evaluates -570 cp White. Removing the pawn which protects Rg7 allows Kxg7 (-756 cp); adding a bishop able to capture the checking rook also refutes it (-572 cp).
- **Contrary mechanism control.** A constructed Rxg7+ Kh8 Qxh7# is mate in two but is not king deflection: the king on h8 still guards h7 geometrically, and the rook has newly protected the queen. The label is withheld. This prevents a mating result alone from funding the wrong mechanism.

Both helpers have 4,096-visit limits and abstain on incomplete proofs. Material self-interference requires the actual old guard to have a legal recapture before the blocking move, newly profitable capture afterwards, all friendly-piece capture liabilities, and immediate mate/promotion checks. Only all-defence interference becomes a root lesson; a branch-only occurrence stays secondary. Mating king deflection is an actual-ply secondary mechanism, not an extra material-win headline. No engine score, supplied tag, or cooperative PV supplies either certificate.

## Position judgements and unresolved cases

| Puzzle | Current judgement |
| --- | --- |
| zYjb5 | Forced interference is the useful main cause; defensive self-interference and rook capture occur later. Corrected. |
| dkEzJ | c3 cuts the queen's defence of the rook while attacking the queen. Existing Interference is appropriate. |
| UiHeK | The checking attack has both material and mating branches. Keep Forcing Attack primary and the actual Rxh2+ skewer at ply 3; source interference/deflection tags alone cannot replace it. |
| w8wvY | Rg5 interferes with the rook's defence of h5 and wins a pawn. Root is still unproved; rook exchange and pawn-ending continuations need coverage. |
| IKbcw | Kb2 attacks the pinned knight. Passing does not reverse the winning side under the unrestricted search: White has Ba5 (+434 cp), preserving the pin and waiting. Premature Bxc3 instead evaluates -20 cp. Thus that restricted capture alone is not evidence that the position is a draw with the other side to move. Pin remains the useful immediate lesson; do not certify a supplied zugzwang tag from one losing or drawing alternative. |
| gnlcF | Ra3 wins according to the engine, but the waiting-move/zugzwang explanation remains unproved. A later rook check cannot explain the first move by itself. |
| e9KxD | Genuine missing endgame explanation: after the exchange and ...Ke6, White to move evaluates -655 cp; the identical board with Black to move evaluates +7 cp Black. This supports a reached zugzwang candidate, not a runtime all-moves proof or a root ...Kf6 zugzwang badge. |
| QSKdo | The engine supports ...Kd5 and penetration toward f4. Opposition/zugzwang versus a direct threat still needs a complete causal explanation. Empty is not a correct negative. |
| CSh8J | Nd5+ forks king and knight; accepting deflects the promotion guard. Fork is a defensible root lesson and promotion belongs at ply 3. The conditional guard-deflection explanation could be clearer. |
| ZVq1J | Longer discovered-check/rook-offer combination remains incompletely explained. Source and engine move orders differ; retain later verified mechanisms at their actual plies, not as the initial move's cause. |
| nBrWE | Quiet bishop move, mating threats and queen deflection are a real coverage gap. The winning engine score does not independently prove the intended main mechanism. |
| om0GQ | Mate in three stays primary; the verified king deflection is secondary at Rg7+. Corrected. |
| dLG91 | Ra1 traps the queen; Qxa1+ Qxa1 is queen for rook, not a free queen. Existing Trapped Piece is appropriate. |
| snAK4 | The multi-move queen/rook trap and pin are still unproved at the root. Do not borrow final capture totals. |
| NGZzo | Double Threat is more informative than blindly copying Trapped Piece: a rook retreat can permit Nf6+, forking king and queen instead. |
| GDK87 | The immediate pawn capture is incidental to the rook trap; existing Trapped Piece is appropriate. |
| tA2XR | Fork is the material point; the queen and knight give double check. The supporting checking mechanism could be clearer, without adding unrelated pin/clearance badges. |
| NrHkx | Forced mate remains primary. The bishop vacates c5 for the rook; the separate clearance explanation still needs independent relevance/proof. |
| 4Ds65 | ...Bg4 and ...Rae8 are a quiet pin/preparation gap, not a verified free bishop from the passive source reply alone. |
| 4RNK5 | With engine evaluation, the existing conditional Quiet Preparation is useful; the source-only scan abstains. The later rook offer and skewer must retain conditional/actual-ply wording. |

Among these 20 source inputs, one primary changes (zYjb5) and one other continuation gains a mechanism (om0GQ). The remaining eighteen full classifications are unchanged ignoring version. This is not twenty correct answers.

## Broader regression and delivery scope

Exact-input replays of seven private Woodpecker reports cover 180 positions, including the new 21-position positional quarter sample. Their full source and live results are unchanged ignoring version; those were reclassifications of stored engine lines, not 180 new engine searches. The 32 frozen mistake-priority judgements are unchanged. The new quarter sample's compensating-exchange false positive remains open; private data and detailed receipts stay outside Git.

Final verification and delivery status are recorded in [the current course audit](private-course-review.md). The [135-input production-worker timing receipt](built-worker-adapter81.json) exposes the measured startup and classification times; the additional rare/private inputs are deadline/parity checks, not part of these percentiles. No native app, package or service was restarted/deployed, and source/render/controller tests are not physical WebView proof.
