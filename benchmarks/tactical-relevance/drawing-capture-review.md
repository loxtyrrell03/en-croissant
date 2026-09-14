# Saving captures, not routine drawn exchanges

Adapter 109 / live pipeline 114 adds **Drawing Capture** only when a complete
Lichess Syzygy certificate establishes a drawn root, the nominated legal capture
immediately leaves insufficient material, and every other move loses. Equivalent
captures of the same last piece may also draw; unrelated or quiet drawing moves
disqualify the headline. A root already ended or with a claimable fifty-move draw
cannot qualify. This is a defensive resource with zero invented material profit.

The live Tactics tab uses its existing explicit online-verification action.
A terminal capture requests only the actual root, whereas zugzwang still needs
the real/pass pair. Ordinary local scans never send positions to Lichess. The
eight-second deadline, cancellation, response-size limit, credential/referrer
exclusion and strict complete-record validation remain. Failed lookups retain
the local result; missing proof is not a no-tactic finding.

Mistake review accepts a missed saving capture only if the complete root record
confirms the played alternative loses. Both equivalent drawing captures remain
valid, even if a supplied engine score wrongly claims a loss. An opponent's
saving capture is a proved cause only if a separately verified better move keeps
a win; merely making that particular capture illegal is insufficient. Missing
comparison evidence stays neutral. Root certificates cannot borrow later PV
events, and board geometry shows only the actual capture.

## Chess review and scope

The constructed judgements were frozen before querying the provider. Eleven
final fresh records are in `drawing-capture-tablebase-verified.json`:

- Taking a loose rook/queen, taking the queen at the payoff of a knight fork,
  or removing the last dangerous passed pawn can be the only drawing move.
- King and knight captures of the same queen are equivalent drawing resources.
- The colour-reversed rook capture has the same result.
- Rook-versus-bishop has several quiet drawing moves: no saving-capture headline.
- An already-dead bishop ending stays quiet.
- A queen capture that stalemates throws away an available win: it is **not** a
  saving resource. Automatic attribution of a played terminal stalemate remains
  a separate gap; this control does not claim that feature is implemented.
- A rook offer is compared with a winning rook retreat and another drawn move
  before attributing its opponent's saving capture.

Seven fixture rows qualify; this includes a colour reflection and an exact
reached-position duplicate with a different clock, not seven independent game
discoveries. Four rows do not qualify. Exact provider outcomes, not Stockfish
centipawns or classifier output, decide this slice. The initial illegal setup
and an incorrect reached-position clock were corrected before final validation;
their incomplete/intermediate receipts remain private and are excluded.

An output-blind scan of the previously used public August game archive contained
three standard games and **no** terminal insufficient-material captures. Those
are recorded omissions, not extra positive tests. `drawing-capture-games.mjs`
reproduces the scan. No player headers, comments, clocks or paid material are
published. The new saving examples are constructed controls, not real-game
accuracy estimates.

## Verification

- All 2,266 selected tests pass, including all 246 private-course replays. Their
  full source/live classifications and the 45 fixed ordinary-game nature results
  are unchanged apart from version metadata. Twenty prior rare primary lists
  and 32 frozen causal priorities remain; stability is not accuracy certification.
- All **1,551** production-controller worker inputs pass: 1,021 prior public,
  22 new public verified/local pairs, and 508 private. All prior public primary
  lists are unchanged, comparing game IDs **and** source/best/response lanes.
- Public compute/transfer median/p95/max is **34/183/960 ms**; engine and native
  UI time are excluded. See `built-worker-adapter109.json` for hashes and scope.
- All 81 forced-cold HTTP cases pass: first/max worker startup **1,205/1,586 ms**,
  server preparation **3,262 ms**, max compute/transfer **1,204 ms**. Earlier
  high-load startup variability is not certified fixed by this run.
- Sixteen actual React/Chrome groups cover both exact-endgame actions at
  1100/760/360px and 100/200% text, including keyboard, retained local loading,
  retry, cancellation, scrollable explanations and precise preview geometry.
  Screenshots were inspected; HTTP uses captured public fixture replies.
- Whole-project type checking, scoped lint, shared-review/app builds and six
  service/development-cache checks pass. The production worker is
  `liveTactics.worker-DLsMbXwe.js`, SHA-256
  `4ea79c3688c4da3e59207f21c628700e38f215d4d4990860bb09a14e9c623c1f`.

Private evidence lives under `Documents/OnCrescent Tactical Benchmarks/`:
`adapter109-selected-final.json`, `adapter109-nature-verified.json`,
`adapter109-rare-verified.json`, six `adapter109-worker-*-verified.json` reports,
`adapter109-dev-cold-verified.json` and `drawing-capture-game-sample.json`.
This source milestone does not itself certify installed/native operation.
Desktop delivery is recorded separately after its build and checks.
