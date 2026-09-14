# Exact endgame themes without positional noise

## Adapter 100 / live pipeline 105

The classifier can use separately supplied, exact-position Syzygy responses to verify larger-ending zugzwang. A quiet move qualifies only when forcing the opponent to move changes the best-play outcome relative to passing on the identical board. Ordinary opposition, a favourable engine score, a source puzzle tag or a later pawn win is not enough. This expands one provable endgame mechanism; it does not establish general classifier accuracy or complete endgame coverage.

The Tactics tab offers **Verify [move] online** for eligible four-to-seven-piece positions. This is an explicit, one-position action, not automatic uploading or a new dependency of the normal local scan. Its privacy explanation is visible. The local result stays available while checking and after failure; Cancel and Retry are adjacent. The original engine scores, MultiPV lines and previous-move context are retained when reclassifying. Neither the engine search nor its deadlines change.

## Chess judgements and contrary examples

The [fresh development receipt](tablebase-relevance-verified.json), [supplementary receipt](tablebase-relevance-supplementary.json) and [reciprocal receipt](tablebase-relevance-reciprocal.json) contain 52 successful queries and 397 complete legal-move records across 22 distinct root/move cases. Four roots are deliberately queried again in the supplementary run. These are small development checks, not a representative accuracy estimate. No Stockfish centipawn threshold is used to infer the exact outcomes.

| Position and move | Reviewed conclusion |
| --- | --- |
| Real Lichess EKWHC, Kf4 | Wins; all five Black replies lose, but Black could draw with a pass. Zugzwang is the immediate lesson. The other five legal root moves do not qualify. |
| Real Lichess 6fO6p, h4 | The pawn tempo creates genuine winning zugzwang. The later king invasion is not borrowed as a root capture. |
| Constructed reciprocal of EKWHC, ...Kf6 | Holds a draw instead of losing if White could pass. Some White moves lose, so the copy correctly says the **best** defence draws, not that all moves draw. ...Kd6 loses instead. |
| Colour/rank reflection of EKWHC, ...Kf5 | The independently queried counterpart preserves the win/pass-draw distinction and Black's authorship. |
| Real IKbcw, Kb2 | The pin/pawn-ending material mechanism still wins with a pass. Its supplied zugzwang tag must not replace the existing root explanation. |
| Real wXMJJ, Kf4; iKN3Q, Kg4; 8zRYr, ...Kg5 | All remain winning with a pass. Their source zugzwang tags do not certify the initial move; root pawn threats, infiltration or later waiting moves must be judged separately. |
| Equal rook/queen manoeuvres; genuine wrong-bishop rook-pawn ending | The exact same-outcome controls do not acquire a zugzwang headline. |

The four other small-ending, zugzwang-tagged development roots were taken exhaustively from the existing public Lichess fixture after excluding the two already selected roots, in fixed SHA-256 order. No held-out row or classifier output selected them. The six-piece alternatives enumerate all legal root moves, not just Stockfish's preferred continuation. The reciprocal drawing and colour-reflected boards are constructed variants, not additional real games.

Two initial assumptions were corrected, not silently counted as successes. A queen manoeuvre in the first harness was illegal; the [initial receipt](tablebase-relevance-development.json) stops before it, and the rerun uses a legal equal queen ending. The initial c2-bishop/a6-pawn example was incorrectly described as a wrong-bishop ending: c2 and a8 are the same colour, and Syzygy correctly returned a win. That contrary initial judgement remains in its receipt. The separately added d2-bishop control really is the wrong colour and draws. Extra locked wing pawns also invalidate the tempting direct extrapolation from the simpler KPK opposition example; those larger positions are not accepted as drawing zugzwangs.

## Proof and integration boundaries

The pure verifier checks exact FEN identity, including the halfmove clock; side-to-move outcome orientation; every legal reply including all four promotions; terminal flags; parent/child minimax consistency; and agreement with the local KPK bitbase where available. The hypothetical pass changes the turn, not the clock. Duplicate, incomplete, malformed, uncertain or wrong-position responses cannot certify a theme. Castling/en-passant rights, captures, promotions, checks, terminal positions, more than seven pieces and near-claim quiet entries remain outside this entry rule.

The [provider contract](https://github.com/lichess-org/lila-tablebase#http-api) distinguishes certain outcomes from unknown/maybe/Syzygy-only categories. The latter are rejected. Cursed wins and blessed losses are interpreted as draws under the fifty-move rule. This validates a provider certificate and its consistency, not the entire external database from first principles. Thirty-eight independently sampled, previously frozen KPK responses also pass the same validator.

Only the initiating move gets the root label and arrow; the label anchors to the compelled king. The same certificate cannot migrate to a different root, variation or later FEN. Normal quiet/terminal continuation boundaries remain. A newly available certificate cannot reuse an evidence-free cached mistake judgement, and evidence-bearing results cannot contaminate the ordinary cache.

The mistake adapter supports missed winning and drawing opportunities and separately checked allowed zugzwang. For the real ...Kf6 mistake, the independent ...Ke6 outcome proves that the better move draws instead of allowing a loss. Without that better-position response the comparison stays neutral. **Automatic game-review collection does not yet acquire these larger-ending certificates**; only the explicit Tactics-tab action performs the new lookup. This is not a claim that every stored mistake now receives an online endgame explanation.

The lookup is sequential, at most two positions, with an eight-second total bound and 128,000-byte limit per response. It sends no cookies or referrer and has no automatic retry. The existing worker startup/computation limits remain 20/3 seconds; lookup time is separate and never blocks the local result. Cancel, navigation and unmount abort ownership; late lookup/worker responses cannot update the board. Failures remain unavailable, not correct negatives.

## Verification and delivery

Sixty-six new pure/transport/rendered checks cover the independent positives and negatives, drawing and missed/allowed semantics, precise board geometry, complete promotions, eligibility boundaries, malformed responses, deadline/cancellation and stale results. The selected suite passes **1,895 tests**, with 85 conditional skips, across 125 files (124 passing and one entirely conditional file skipped). TypeScript, sixteen-file lint, shared-review/app builds, three service tests and two development-cache scenarios pass. Existing large-chunk/Babel build warnings remain.

All 246 frozen private source/live results and all twenty rare-theme results remain identical apart from version metadata; the thirty-two frozen primary judgements remain passing. These are stability checks, not newly verified accuracy. Private final source replay: `Documents/OnCrescent Tactical Benchmarks/adapter100-exact-replay.json`; rare replay: `rare-theme-adapter100.json`. Paid material is not exported.

Eight actual-Chrome renderer groups pass with the real component, lookup module and browser worker: offline/loading/verified states at 1100/760/360px and 100/200% scale, plus error/retry and cancellation/local-retention. The HTTP responses are explicitly intercepted public fixtures; this proves UI wiring and browser-worker execution, not live-provider/native WebView reliability. Screenshots and the report are under `tmp/tactical-endgame-adapter100/`; actions fit and the existing scrollable result remains usable. The renderer is reproducible with `scripts/qa-tactical-endgame.mjs` and a `TACTICAL_QA_DEPENDENCIES` package location providing Playwright.

All **1,055 actual-controller production-worker inputs** pass fifteen tests against `liveTactics.worker-Danuc_29.js`. The [549-input public receipt](built-worker-adapter100.json) includes the 22 new endgame cases, with elapsed median/p95/max **72/225/844 ms**, maximum startup 48 ms and computation/transfer 813 ms. Every one of the 527 prior public primary-ID lists is unchanged. The additional private inputs stay private. Timings exclude engine, online lookup and native UI; a changed case mix and different machine load are not an optimization claim. Final private worker receipt: `built-worker-adapter100-final-private.json`.

All 29 isolated cold HTTP cases pass under the unchanged controller deadlines, including the larger winning/drawing certificates and earlier opening, fork, interference, mating and promotion controls. First/next startup is 1,047/79 ms; maximum startup/computation is 1,975/1,311 ms. Server startup/prebuild is a separate 1,791 ms. The earlier run also passes, with first startup 918 ms; neither run overrides prior contrary slow-start evidence or proves stable native latency. Final receipt: `Documents/OnCrescent Tactical Benchmarks/adapter100-final-cold-http-worker.json`.

No owner app/package/service was restarted, installed or deployed. Larger-ending automatic review acquisition, general quiet positional mechanisms, causal primary ranking, and native UI verification remain open. Existing unrelated repository changes are preserved.
