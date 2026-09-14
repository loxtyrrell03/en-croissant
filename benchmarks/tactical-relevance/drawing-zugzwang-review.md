# Drawing zugzwang and quiet-ending accuracy

## Adapter 90 / live pipeline 95

The classifier now recognizes a verified defensive zugzwang that holds a draw, not just one that wins. The headline and board label say **Drawing Zugzwang**. Ordinary opposition, low mobility and a favourable engine score are not sufficient: the exact outcome must improve for the compelled player if that player could pass on the identical board.

This is an expansion of exact K+P versus K coverage, not a claim about all endgames or general classifier accuracy. Existing tactical/positional course, ordinary-game, opening/middlegame and rare-theme regressions were replayed separately.

## Chess judgement

In the constructed ending with White Kc4/Pc3 and Black Kc7, ...Kc6 takes the opposition and holds the draw. After that move, every legal White move leaves a drawn ending; the same board with Black to move is won for White. ...Kd6 instead loses. The defensive mechanism was absent before this change: four new source/review assertions reproduced that omission.

Keeping the White pawn on c2 changes the judgement. White can spend a reserve pawn move and still win, so ...Kc6 is not a drawing zugzwang there. If White unnecessarily plays c3 while the black king is on c7, ...Kc6 becomes a genuine drawing resource; Kb5 instead retains a won ending. The importance of reserve pawn tempi, rather than merely facing kings, is also explained in [GM Joel Benjamin's opposition lesson](https://www.uschess.org/index.php/Ask-GM-Joel/Searching-for-Opposition.html).

Mistake review distinguishes:

- missing one's own verified drawing move;
- giving up a win by allowing the opponent's drawing zugzwang;
- an already drawn position, where the same resource does not prove that the move gave up a win.

The causal comparison uses exact before/better outcomes, not a different speculative PV. It does not accuse a move of losing material merely because the win becomes a draw. The opponent's separately verified winning reply remains primary when appropriate.

## General proof and a second defect

The existing local bitbase now proves either direction of the pass comparison. A bare king forced from draw to loss yields winning zugzwang; the pawn side forced from win to draw yields drawing zugzwang. Same-outcome boards, check, terminal positions and unavailable fifty-move bounds abstain. Every real reply is checked, including pawn moves. Promotion exits cannot be treated as draws merely because the KPK probe is unavailable: only terminal dead/stalemate positions or a legal immediate king capture of the promoted piece suffice. None of the qualifying canonical zero-clock zugzwangs actually has a promotion reply; this is defensive handling, not demonstrated positive promotion coverage.

The complete-state audit exposed twenty missing drawing certificates after double pawn pushes. chessops retains an en-passant square, but with exactly one pawn there is no opposing pawn that can use it. Rejecting that irrelevant marker incorrectly returned unknown. Ignoring it only within the existing three-piece material gate restores the exact result without changing legal en-passant behavior in larger positions.

The bitbase graph, fifty-move conservatism and worker deadlines are unchanged. Public matching labels remain separate from initial-move proof: an existing zugzwang board is not automatically a motif caused by the next player moving.

## Independent evidence and scope

The [reproducible audit script](../../scripts/benchmarks/kpk-zugzwang-audit.mjs) enumerates all **165,676 legal canonical zero-clock KPK positions**, after colour/file symmetry reduction. It finds 80 winning and 80 drawing zugzwangs under the stated outcome-change rule; 165,516 positions have neither. Proof output matches the existing retrograde outcome relation for every enumerated position. This internal agreement is not independent tablebase validation. The existing exhaustive move-graph/promotion-exit tests still compare the graph with chessops.

The script selects positions by fixed SHA-256 ordering and structural outcome/rank strata, before classifier outputs: ten drawing cases across five available pawn ranks, three winning zugzwangs, three both-win and three both-draw controls. The [frozen independent Syzygy receipt](drawing-zugzwang-tablebase-verified.json) contains 38 successful actual/pass queries, 184 returned legal move records and 57 legal replies in the thirteen zugzwang examples. Every queried outcome agrees; every qualifying actual move set and resulting category is checked. The [Lichess tablebase API](https://github.com/lichess-org/lila-tablebase#http-api) reports child-position categories from the side to move there, so the audit does not confuse a child's win with its parent's win.

The [initial audit receipt](drawing-zugzwang-tablebase-development.json) preserves the twenty pre-fix missing certificates; it stopped before making network requests. Re-running without --tablebase is entirely offline. Network probing is explicitly opt-in, sequential, bounded per request and stops on HTTP failures rather than skipping contrary results.

Forty-two fresh depth-16 Stockfish searches also inspect every selected actual/pass board and the four practical reserve-tempo/opposition decisions. All are consistent with the exact outcomes: drawn estimates range from 0 to +10 cp in the structural sample, while corresponding wins/losses are around five pawns or forced mate. The practical holding move is -4 cp from Black's perspective; that is not a material loss certificate. Exact tablebase outcomes, not exact engine centipawn equality, determine draw versus win. Private receipt: Documents/OnCrescent Tactical Benchmarks/adapter90-drawing-engine.json.

## Regression and delivery verification

Eighty-six new source/review checks cover the frozen independent receipt, 76 colour/file-reflected classifications, drawing and missed/allowed causation, unused en-passant metadata, reserve tempi and abstention controls. One additional exhaustive KPK test and one rendered panel test preserve drawing wording, immediate board geometry and the absence of a future promotion headline. The selected suite passes **1,588 tests**, with 91 conditional skips in 108 files (106 passing). Whole-project type checking and ten-file lint pass.

All 225 frozen course/generated-game source and live results remain unchanged, as do all twenty rare results and 32 frozen priority judgements. These are regression stability results, not newly certified correct negatives. No new human-game corpus sample was added in this milestone. Final private replays: adapter90-final-exact-replay.json and rare-theme-adapter90-final.json.

Shared-review (40 modules), app (8,870 modules), three built-service tests and two development-cache/recovery scenarios pass. Seven isolated cold HTTP cases pass under unchanged bounds: first/next startup 1,466/67 ms; drawing opposition startup 58 ms and classification/transfer 430 ms. These isolated-server measurements exclude engine/UI and do not establish stable or native WebView performance.

All **661 actual-controller production-worker inputs** pass thirteen tests against liveTactics.worker-BYTc7k8I.js. The [198-input public receipt](built-worker-adapter90.json) records elapsed median/p95/max 82/215/605 ms, startup maximum 34 ms and computation/transfer maximum 574 ms, excluding engine/UI and additional private/rare inputs. The unchanged 177-input subset measures 80/241/605 ms; every prior primary-ID list is unchanged. The larger aggregate has a different case mix and is not a speed-improvement claim. Twenty-one new worker inputs cover the nineteen selected predecessors, direct drawing opposition and the spare-tempo negative.

No owner app, package or service was restarted or deployed. Broader quiet mechanisms, positional pressure versus tactics, larger-ending zugzwang, causal ranking and native UI verification remain open. This change expands a provable ending class while retaining abstention elsewhere; it does not convert every positional plan into a tactic.
