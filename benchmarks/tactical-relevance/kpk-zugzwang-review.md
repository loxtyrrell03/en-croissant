# Exact pawn-ending zugzwang — adapter 84 / live pipeline 89

## Chess judgement and selected real game

The additional [CC0 Lichess development position](kpk-zugzwang-development.json), wXMJJ, now distinguishes two lessons. Kf4 attacks the opposing pawn, and every one of seven legal replies permits Kxe3 or Kxe4 into a winning king-and-pawn ending. **Winning Pawn Ending** is the root explanation. Later, after ...Kf5, **Kf3 is Zugzwang at ply 5**: all five legal king replies lose, but the identical board with White to move is drawn. The first move is not given the later zugzwang badge. Board arrows show the actual king move; the timeline remains collapsed and contains no extra free-pawn badge.

The source was selected by material count from the existing local development fixture, not by classifier output. Inspecting every development continuation entering K+P versus K found three reached positions, all from this game. It is an additional reviewed game, not a held-out set or evidence that all rare themes are solved. Its fixture SHA-256 is c80356923da60cce5b48b37046a878290f36997862f921b944015a3cf69ccc88. Source tags nominate ideas; they do not admit a runtime theme.

## Independent finite proof

The lazy local KPK table covers both turns and reflects pawn colour/file symmetry. Its complete canonical graph has 196,608 encodings, 165,676 legal positions and 1,062,815 legal within-table edges. The promotion attractor contains 111,282 winning positions; the longest finite conversion rank is 38 plies. Those are exact endgame-table properties, not counts of correctly classified tactical puzzles.

Every winning position has a decreasing promotion proof: the pawn side chooses a winning move, while every defending reply remains winning. The residual drawn region supplies a closed defensive strategy or a draw exit. Queen and rook promotion exits explicitly handle immediate king captures and stalemate; promotion is a conversion to a won elementary ending, not checkmate on that move. Tests compare every canonical state's validity and complete move set with chessops, check every applicable promotion exit, and verify the winning-rank/drawn-region equations exhaustively. The independent queue implementation uses the general retrograde method also described in [Stockfish's KPK reference](https://github.com/official-stockfish/Stockfish/blob/sf_15/src/bitbase.cpp); it does not query Stockfish or a remote table during a scan.

Runtime admission separately checks the real position, every legal defender move, and the same-board pass counterfactual. Winning with either side to move is not zugzwang. Stalemate, a capturable pawn and a drawn rook-pawn refuge receive no certificate. Colour/file reflections preserve the result. The current tactical admission covers zugzwangs which win for the pawn side; drawing zugzwang resources for the bare king remain a follow-up, as do larger endings.

The four-piece entry proof is distinct: the king must newly attack the exact opposing pawn, every reply must permit that pawn's legal capture, and each resulting three-piece ending must be won. A guarding king, a drawn resulting rook-pawn ending, or promotion by the targeted pawn refutes entry. The earlier finite material-search experiment for larger pawn endings was withdrawn and is not part of the app.

## Mistakes, claims and contrary evidence

Review preserves a missed Kf3 opposition opportunity. In a constructed defensive choice, Kc6 holds a draw whereas Kd6 allows a winning opposition continuation. The exact before/better outcomes support a causal comparison. In the real earlier position, both ...Kf5 and ...Kf6 still lose; its later zugzwang stays neutral rather than being blamed on that choice. Missing comparisons outside KPK remain unproved.

The fifty-move window must survive the quiet entry and defensive reply before a capture resets it. A defender can claim using an announced move, so an entry reaching halfmove 99 cannot assume the pawn capture will occur first. Boundary tests cover initial halfmove 97 (capture reset still timely) and 98 (claim available); the latter is also a production/HTTP-worker negative. This follows [FIDE Article 9.3.1](https://handbook.fide.com/chapter/E012023). Standalone KPK win probes conservatively require the conversion rank to fit before a claim, without crediting earlier pawn resets. Existing repetition claims cannot be reconstructed from a FEN alone.

The [30-search Stockfish receipt](kpk-zugzwang-stockfish-18.json) uses fresh depth-16, one-thread, 32 MB searches with scores from the current side to move. The real root is +504/+501 cp White, and all seven selected capture replies are +502 to +518. Kf3 is +513; the tested missed Kd3 is +4 and the pass counterfactual +18. The exact table, not a centipawn threshold, distinguishes win from draw. In the constructed defensive mistake, Stockfish prefers White Kb5 after ...Kd6; the tested Kd4 (+526) is another table-confirmed win, not its first engine PV. The two already-lost choices are -513/-521 cp Black. These distinctions prevent a teaching variation from being misreported as engine-best play.

Guarded-pawn and rook-pawn controls evaluate drawn; allowing the target to promote loses. An initial proposed rook-pawn negative placed the defending king behind the passed pawn and was not a drawn refuge; the final negative uses the actual corner defence. In the larger e9KxD ending, all three freshly searched king retreats still lose, but exchanges, opposite-wing captures and promotion races defeat the attempted short material certificate. Its genuine zugzwang candidate remains unsupported, not certified fixed.

## Regression and delivery scope

All 180 existing Woodpecker source/live results, all twenty earlier rare-theme results and all 32 frozen priority judgements remain unchanged. These are exact-input reclassifications of stored lines, not 180 fresh engine searches or general accuracy claims. The new real root, actual-ply zugzwang, missed/cause/persistence paths, negative controls and rendered timeline are checked separately.

Final test counts, production-worker timings, cold HTTP evidence and delivery status are recorded in [the current course audit](private-course-review.md). The [public production-worker receipt](built-worker-adapter84.json) separates startup from classification. No app, native package or service was restarted/deployed; source/render/controller evidence is not native WebView or physical UI proof.
