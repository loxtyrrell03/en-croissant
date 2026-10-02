# Public frontier composition adjudication

These are three previously selected CC0 development puzzles, not a holdout or an accuracy estimate. Source tags nominate questions; they are not proof. The 2026-10-02 read-only audit at `662b8e57` checked root-only/full inputs and both colours, independently repeated legal replies with python-chess, and ran 17 bounded depth-16 Stockfish diagnostics (one low-priority thread, 64 MiB). Engine lines are not exhaustive proof certificates. No owner data, downloads, service or installed application changed.

## KmpJY: checking entry into a connected mating attack

FEN: `r1bqk2r/pppnp1b1/3p2p1/6p1/2PPQ3/5N2/PP4PP/R3KB1R w KQkq - 0 12`

Source line: `e4g6 e8f8 f3g5 d7e5 d4e5`.

Qxg6+ has exactly one legal reply, Kf8. The existing child proof independently verifies Nxg5 against all 28 replies: the original checking queen is the mating partner threatening Qf7#, while Ne5 concedes dxe5. Its 320 cp local material bound already includes the pawn taken by Nxg5. Adding only the initial Qxg6 pawn gives 420 cp; this is not the whole-position evaluation or a forced-mate claim. Both colours require 714 child visits under the shared 8,192-operation envelope.

The new `proveCheckingMatingPreparation` composes those certificates from legal moves rather than the supplied PV. Every root reply must preserve the same checker and admit a separately proved, connected, nonchecking capture. Initial capture, defensive capture and promotion debts are counted once. Terminal/draw/budget failures abstain. The original checker must deliver the child's mating threat; a remote later combination cannot fund the label. Existing all-piece liability and countercheck rules remain. Root-only and truncated/full inputs agree. An allowed position lesson does not by itself prove that a preceding move caused the attack; the causal comparison deliberately abstains until that separate comparison is supported.

Focused controls cover missing preparer/collector, an extra king flight, capture of the original checker, exact child/root accounting, root capture resetting the fifty-move clock, a later reset just before versus after an available claim, and exhausted/invalid budgets even after a successful cache entry. The unfinished checking-ray feature remains separate.

## ilrgH: an existing, correctly limited mating-threat observation

FEN: `3r1r1k/p1q1bBpp/5p2/4pPPQ/7P/2N5/PPP5/2KR3b w - - 0 21`

Source line: `f7g6 d8d1 c3d1`.

After Bg6, exactly 40 of 42 legal replies permit Qxh7#. Only h6 and Rxd1+ stop immediate mate. After Rxd1+ Nxd1, Qxc2+ is still legal: the source endpoint is not a settled forced gain. The existing stronger proof fails that checking branch, not its budget.

Production already returns **Threatens Mate** for root-only/full lines in both colours when a finite relevant score is supplied (`rootCp >= -100`); with no score it intentionally abstains. The score-free frontier row therefore does not establish a missing observation. This is a concrete threat with named defences, not forced mate or material gain. Qh5 already pins h7 before Bg6, preventing hxg6; it is supporting geometry, not a newly created root pin. Moving the queen to g4 unpins h7 and correctly removes this certificate in both colours.

## Kn14A: a genuine defensive counterthreat, still unproved as a full win

FEN: `1k2b2R/2p5/Qp1p4/3Pp3/N3P3/PK3r2/1P6/1q6 w - - 15 40`

Source line: `a4c3 f3c3 b3c3 b1c1 c3b3`.

The four legal check evasions are Kb4, Kc4, Nc3 and Qd3. Nc3 interposes against the rook while making Rxe8# playable again. Of its 27 replies, 19 permit that immediate mate. The eight parries are Qd1+, Qa2+, Qxb2+, Qc2+, Rxc3+, Rf8, c5 and c6. After c5/c6, Rxe8+ Kc7 Qc8# is exact. Fresh depth-16 searches favour Nc3 and reject the other three choices; Kc4 Qxe4# is also independently verified mate. Finite engine values do not prove every continuation wins.

After Rxc3+ Kxc3 the exchange gain still faces five legal queen checks. After the source's Qc1+ Kb3, six further checks remain. The present attacking proof and modest observer exclude roots made while in check. A temporary memory-only removal of two attacking gates still fails Rxc3+ after 451 visits in both colours. Those production gates were not relaxed. The empty root remains a coverage limitation, not a certified positional negative.

A future modest observation could say **blocks check and threatens Rxe8#**, explicitly counting all immediate parries, without promising a forced win or the only defence. It needs a dedicated check-evasion interpretation, legal/nonterminal and draw checks, complete bounded reply enumeration, engine relevance and truthful no-forced-win wording. Do not globally remove the offered-preparer guard: Rxc3 captures this interposer. Full material retention through the subsequent king escapes remains unresolved. Contrary controls include a missing mating rook, removal of the initial check when mate was already available, losing Kb4, and Kc4 allowing immediate mate.

## Evidence boundary

The independent audit retained compact local receipts for every legal root reply, source-prefix counterchecks, mirrored controls and selected fresh engine searches. The two original/reflected positions give identical legal-reply counts in chessops and python-chess. Ten mirrored contrary controls pass. These observations and the dedicated composition regressions constrain particular mechanisms; they do not establish broad classifier accuracy or deployed behaviour.
