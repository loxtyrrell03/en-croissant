# Mistake-nature context: output-blind initial review

These 24 boards are fixed plies from five legal public game histories. Selection
was fixed before fresh engine searches or inspecting the nature classifier's
answers. The six unavailable requested plies are recorded in the sample, not
replaced. These are board-based hypotheses, not ground-truth accuracy labels.
In particular, the move actually played need not be a mistake.

The purpose is to distinguish an independently established tactical cause from
ordinary checks, exchanges, later PV events and unresolved attacking positions.
The supplied games' continuations are context, not proof against best defence.

| Game | Ply | Initial judgement |
| --- | ---: | --- |
| yOwOb8mH | 8 | Central development and a pawn exchange after the bishop recapture. Do not call an ordinary d-pawn break a material tactic without a concrete gain. |
| yOwOb8mH | 21 | Bishop pin, development and bishop/knight exchanges. A geometric pin is not necessarily a tactical punishment. |
| yOwOb8mH | 40 | Knight outpost and bishop manoeuvring, with c2 pressure. Later pawn captures do not explain the current root. |
| yOwOb8mH | 59 | Uncertain and potentially tactical: Qa4 attacks Rb3 while White has kingside pressure. Check compensation and mating threats before calling the rook hanging. |
| yOwOb8mH | 80 | Rook ending: king activity and defending c3. Later pawn exchanges are not automatically immediate tactics. |
| yOwOb8mH | 99 | Dangerous passed b-pawn, rook defence and active king. Do not infer zugzwang just because the defender has few useful moves. |
| 8OYE3aem | 8 | Stonewall-style development and central/kingside plans. No obvious root material combination. |
| 8OYE3aem | 21 | Kingside attack versus central counterplay after a bishop exchange. Quiet development and later exchanges need causal scrutiny. |
| 8OYE3aem | 40 | Sharp attack: Rh3 is attacked by g4, but opening lines may supply compensation. Neither a forced mate nor a simply hanging rook is established by the game line. |
| eTscGjLx | 8 | French Advance development and central pressure. Future exchanges do not make the opening move a tactical mistake. |
| eTscGjLx | 21 | Development and castling, queen manoeuvres against knight pressure. No obvious immediate material gain. |
| eTscGjLx | 40 | Uncertain exchange geometry: Bb4 attacks Na3 and Be7, but the victims have protection and exchanges. A visual double attack alone is insufficient. |
| eTscGjLx | 59 | Open-file liquidation and endgame choice. Do not label routine reciprocal rook captures as separate hanging pieces. |
| eTscGjLx | 80 | Queen ending with an exposed black king: a quiet mating net is plausible. This is not a presumed positional negative. |
| BkwHTU3l | 8 | Queen's Gambit development and a positional pin, followed by ordinary exchanges. |
| BkwHTU3l | 21 | Check evasion: recapturing Nf6 with queen versus g-pawn can change structure. The forced recapture is not automatically a missed free knight. |
| BkwHTU3l | 40 | Heavy-piece counterplay after Black captured a bishop. Recapture, active rooks and back-rank danger need comparison; later checks alone do not establish the root cause. |
| BkwHTU3l | 59 | Genuine king-hunt candidate. Test f5+ against all king evasions, not just the game ending in mate. |
| oD1ADLSC | 8 | Scotch development, pin and knight tempo. A geometric attack or later exchange need not win material. |
| oD1ADLSC | 21 | Knight-for-bishop exchange and pawn structure. Later pawn recovery is not sufficient evidence of a tactical root lesson. |
| oD1ADLSC | 40 | Rf1 can attack Qf5, but an ordinary queen retreat is not a won-queen threat. The preceding rook exchange must not be counted again. |
| oD1ADLSC | 59 | Heavy-piece ending with back-rank pressure and queen unpinning. Distinguish immediate threats from later pawn captures. |
| oD1ADLSC | 80 | Exposed white king and queen/rook pressure. Forcing possibilities remain unresolved; do not assume the position is quiet. |
| oD1ADLSC | 99 | Rook ending with a passed a-pawn and king escort. Promotion or zugzwang requires actual defensive evidence, not a later advance in the game. |

No numerical accuracy claim follows from this initial review. Engine estimates
are whole-position estimates and must remain separate from local certificates.
