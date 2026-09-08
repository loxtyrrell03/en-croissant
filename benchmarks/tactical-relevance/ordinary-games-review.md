# Ordinary-game longitudinal judgement

The fixture contains all three standard-chess games from the selected complete
public August 2026 archive. It was frozen before inspecting classifier output.
Positions are sampled every fifth reached ply from ply 8 through 60, alternating
the side to move. No score, result, rating, mistake or theme filtering selected
the games/positions. Source URL, body hash and complete legal UCI mainlines are
retained; player headers and clocks are not. This is one small development
sample from one account, not representative accuracy evidence.

Fresh Stockfish 18 searches run before and after each sampled move at depth 16,
MultiPV 3, with a fresh single-thread/32 MB engine process per unique FEN.
The report records all engine lines, live candidate/timeline evidence and
Mistake Review's allowed/missed explanations. Live scans receive the actual
previous FEN/move, as the desktop panel does. Raw `cpLoss` uses the adapter's
existing 10,000 mate sentinel when applicable; such rows are mate transitions,
not literal centipawn-loss measurements. A sample need not be a mistake.

## Position-by-position judgement

“Quiet” means no useful tactical headline for the side to move's best line;
it does not mean equal evaluation or absence of every geometric relationship.
In particular, a quiet reply can follow an opponent's tactical mistake.

| Sample | Judgement |
| --- | --- |
| ordinary-1:ply8 | Quiet: e4 develops the centre; no justified material combination. |
| ordinary-1:ply13 | Quiet: c6 is a defensive/development choice after castling. |
| ordinary-1:ply18 | Qxa6 wins the bishop just placed on a6; Hanging Piece is concrete. |
| ordinary-1:ply23 | Quiet live root for Black. The preceding Bh3 missed a strong queen capture/mating continuation; its deeper mating priority still deserves work. |
| ordinary-1:ply28 | Qxd8# is the immediate lesson. Mate already existed before Qd8, so it is existing danger, not newly caused by that choice. Slower mating alternatives and their incidental bishop skewer are noise. |
| ordinary-1:ply33 | Quiet live root for Black. White missed a stronger checking continuation; its long mating outcome is not yet the main local lesson. |
| ordinary-1:ply38 | Quiet: Nd4 improves the knight; a large material advantage does not itself create a tactical theme. |
| ordinary-1:ply43 | Quiet: hxg6 takes a pawn, not a significant loose-piece tactic. |
| ordinary-2:ply8 | Quiet: e5 gains a development tempo against Nf6; the later queen/knight exchanges are speculative continuations. |
| ordinary-2:ply13 | Quiet: Ne7 answers the pawn check; no separate tactical win for Black. |
| ordinary-2:ply18 | **Corrected priority (adapter 27):** f7+ has an all-defences mate-in-seven proof, including promotion and quiet Bc4. Forcing Mate replaces the smaller checking-fork preparation as the headline and the explanation of Ke8's damage. |
| ordinary-2:ply23 | Quiet live root: Qxe7 recaptures the pawn after it took a bishop. White's missed f7+ has a verified material idea, but how much its promotion choice matters remains a separate question. |
| ordinary-2:ply28 | Quiet: Bxd5 is a pawn capture, not a substantial tactical lesson. |
| ordinary-2:ply33 | Quiet: Bd7 blocks the check; later events do not establish a root tactic. |
| ordinary-2:ply38 | Quiet: b3 is a forced defensive response. |
| ordinary-2:ply43 | Quiet: Kf7 answers the check. |
| ordinary-2:ply48 | Nxa4 wins the loose bishop; keep the immediate capture lesson. |
| ordinary-2:ply53 | Verified mate in three is the useful root lesson; the final named mating pattern remains a payoff. Existing-danger comparison prevents blaming an equivalent already-losing move. |
| ordinary-2:ply58 | Quiet for White, which is answering an opponent's forced mate. |
| ordinary-3:ply8 | Quiet: ordinary e4 development. |
| ordinary-3:ply13 | **Corrected noise:** Bxf6 recaptures a bishop that just took a knight. The 320/330 exchange is compensated; neither live Tactics nor Mistake Review should call that bishop hung. |
| ordinary-3:ply18 | Nxg5 really wins the bishop moved to g5 without compensation; retain Hanging Piece. |
| ordinary-3:ply23 | Quiet live root for Black. White missed Nc7's queen/rook fork; the missed fork remains useful review evidence. |
| ordinary-3:ply28 | Bxf7+ wins queen for bishop, a net material gain. This queen danger already existed, so it must not be blamed on the equivalent fxg5 choice. |

The corrected report has 17 empty live headlines and seven non-empty ones.
All seven now have accepted immediate lessons: adapter 27 independently
proves f7+'s mating attack against every legal defence, including replies to
the non-checking promotion and Bc4. It leads with Forcing Mate, not the smaller
checking-fork preparation. Fresh before/after searches confirm Ke8 permits
this attack while Kxf6 removes the checking pawn. The other 23 headlines are
unchanged. These counts describe the sample, not a precision/recall estimate.
The 17 quiet roots and seven positive roots are fixed regression judgements.

The fresh f7+ live scan took 743 ms after engine analysis; the subsequent
review took 44 ms with shared proof caches warm. These are in-process
diagnostics, not end-to-end desktop latency. Its timeline reaches Qb5# through
the quiet preparation but no longer describes the irrelevant discovered rook
attack on that checkmating move. The promotion label states what happened;
it does not claim promoting to a bishop was uniquely necessary.

## Root causes of the noise and safeguards

- The causal audit had accepted any proposed pin/skewer merely because its
  enclosing line ended in verified mate. Skewers now require their own material
  evidence; a mating pin needs an actual forbidden capture revealed by removing
  the pinner, or independent material evidence. Existing mating/capture motifs
  remain separate.
- The continuation timeline already recognized compensated captures, but the
  same exchange at a newly viewed root was reconstructed as a loose piece.
  Live and review roots now use that same compensation check only after the
  previous move legally replays to the exact current FEN. Missing/mismatched
  history cannot hide a capture. Filtering also covers the timeline so its
  per-ply audit cannot reintroduce the removed label. A mating recapture keeps
  its mate lesson.
- When PV1 is mate in one, the live selector retains only other mate-in-one
  alternatives, not longer mating stories. Other winning alternatives retain
  the existing viability policy.

Long/quiet mates, promotion-role necessity and stronger source-wide game
coverage remain open. No live desktop, phone, website or Outpost deployment
was performed for this diagnostic.
