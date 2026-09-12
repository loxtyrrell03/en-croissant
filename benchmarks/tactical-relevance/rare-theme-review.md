# Rare-theme real-game review — adapter 82 / live pipeline 87

## King-safe interference follow-up

The previously missing **w8wvY** rook ending now leads with Interference. Rg5 cuts Rf5's defence of h5, making Kxh5 legal. The important move-order exception is ...Kf6: immediate Kxh5 loses the rook (fresh Stockfish -1111 cp White), whereas Rxf5+ followed by Kxh5 after the recapture preserves the gain. Conversely, ...Rxg5 Kxg5 also wins a pawn; after ...h4 the certified capture is Kxf4, another pawn originally defended by the same rook. All twelve root replies and sixteen further replies after the relevant exchanges have concrete checked answers.

The new proof has a shared 4,096-visit cap and at most two attacking replies after the root. It positively verifies the king-safety change by removing the exact guard in a protection probe; an illegal exchange sentinel is never treated as profit. Only the original guard, its originally defended targets and the actual blocker exchange can fund the gain. A declined exchange may retain material already captured by saving that capturer. Leaves debit all friendly-piece capture liabilities and reject immediate mate/promotion refutations. This remains a local material proof, not a complete endgame solver.

The root lesson, missed opportunity and board arrows agree. The pawn capture gets **Interference Payoff** only at its actual, certificate-matching ply; exchanging the rooks is not labelled a free rook. A different or unsafe continuation cannot borrow that payoff. Nineteen other full rare-sample results and all 180 stored Woodpecker source/live results remain unchanged ignoring version, as do the 32 frozen priorities. Empty or unchanged results are not accuracy successes.

The [40-search follow-up receipt](king-interference-stockfish-18.json) includes 28 selected real branch/leaf answers, both root searches (+401/+337 cp White), constructed controls, and the two searches completed before a deliberately retained failed expectation. A knight blocking a bishop's ray also wins a pawn locally, but its full ending evaluates only +8 cp: the earlier expectation that a pawn gain implied a winning evaluation was wrong. Accepting that knight gives a winning pawn ending instead (+526 cp after Kxe5). Likewise, the extra-Na6 control loses a knight to ...Rxa6 after taking h5, invalidating this local pawn-gain certificate even though White's overall position remains winning (+465 cp). These controls distinguish a local tactical mechanism from the result of the whole game.

Earlier proposed controls were corrected before certification: ...Kg6 after Kxg5 is illegal because the kings would be adjacent, and ...Rxf3 from f6 is blocked by the pawn on f4. The actual h4 branch and off-square Na6 liability replace those hypotheses. The public receipt preserves the contrary engine evidence rather than counting rejected expectations as classification improvements.

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
| w8wvY | Rg5 interferes with the rook's defence of h5 and wins a pawn. Corrected in adapter 82, including both rook-exchange directions and the actual-ply pawn payoff. |
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

Relative to adapter 80, adapter 81 changed one primary (zYjb5) and added a mechanism to one other continuation (om0GQ). Adapter 82 additionally recovers w8wvY, leaving the other nineteen adapter-81 full results unchanged. This is not twenty correct answers.

## Broader regression and delivery scope

Exact-input replays of seven private Woodpecker reports cover 180 positions, including the new 21-position positional quarter sample. Their full source and live results are unchanged ignoring version; those were reclassifications of stored engine lines, not 180 new engine searches. The 32 frozen mistake-priority judgements are unchanged. The new quarter sample's compensating-exchange false positive remains open; private data and detailed receipts stay outside Git.

Final verification and delivery status are recorded in [the current course audit](private-course-review.md). The [138-input production-worker timing receipt](built-worker-adapter82.json) exposes the measured startup and classification times; the additional rare/private inputs are deadline/parity checks, not part of these percentiles. No native app, package or service was restarted/deployed, and source/render/controller tests are not physical WebView proof.
