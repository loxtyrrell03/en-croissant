# Missed tactical options outside the preferred engine line

Adapter **114** / live pipeline **119** continues the same three-game,
217-position owner audit. The previous milestone recovered the opponent's
alternative knight capture. The next move, castling instead of taking that
knight, still had no missed lesson because the preferred checking combination
was unexplained. The live tab already had the capture; this milestone recovers
its **mistake-review** explanation, not a newly found live-board tactic.

## Chess judgement and evidence

The private eight-search decision audit supports taking the knight immediately:
the held capture scores +664 cp for Black, versus +576 for held castling.
After castling, a central pawn push attacks the queen and gives the knight time
to escape. Taking the knight then permits a queen capture and scores -127 cp
for Black. These are finite-depth whole-position estimates, not the capture's
320 cp local material bound. Black remains winning after castling; the lesson
is a missed stronger option, not a claim that castling loses the game.

The frozen same-search nominations are +728/+644/+555. The separate held-search
+664 result is not inserted into that batch to cross an admission threshold.
The earlier opponent-cause rule (preserve half the swing) is unchanged. A missed
**option** instead needs at least 50 cp improvement over the played evaluation
and must be within 100 cp of the preferred move. These are nomination policies,
not independently calibrated strength or accuracy guarantees.

## Implementation and safeguards

- Preserve up to three before-move engine candidates with their board, legal
  full PV, depth and side-to-move score. Both principal and alternative must be
  at least depth 14; the alternative cannot be shallower. Mate scores are not
  converted into finite nomination values. Played moves, including equivalent
  castling notation, cannot become missed alternatives.
- Only fill a missing immediate missed-root lesson. Nominate in engine-score
  order, then run the existing motif verifier. Only a high-confidence immediate
  certificate qualifies; later motifs, tentative quiet threats and comparable
  capture choices cannot supply the alternative lesson. A constructed verified
  fork also exercises this path; it is not restricted to hanging pieces.
- Keep the alternative's board and actual first move separate from the principal
  timeline. Both review readers expose it under **Alternative move you missed**.
  The principal answer and practice grading are unchanged; this is explanatory
  support, not a new interactive alternative-board/answer-selection feature.
- An established opponent cause stays primary over an alternative missed option;
  a qualifying option can remain secondary. This distinction matters for saving
  resources with zero material value.
- Native review retains candidates from its already configured before-move
  search, without changing its search count or MultiPV setting. Phone/background
  review widens the before search only for an already eligible card lacking an
  immediate missed lesson. Explicit cached upgrades do not repeat cloud lookups;
  a completed width-three request is remembered even with fewer legal lines.
  Ordinary cache reads and legacy after-move reuse retain their earlier policy.
- Schema, cache keys, saved nature and idle motif migration retain the candidates.
  Existing single-line cards cannot invent missing evidence: new analysis is
  still necessary, and no old progress, selection or scheduling is reset.

Existing proof budgets and deadlines are unchanged. At most two nominated
alternatives use the existing per-proof bounds; there is no new single global
node bound or whole-game minimax guarantee. Normal scans make no new network
request. The wider local review search is additional work on eligible cards.

## Contrary evidence and verification

The first whole-game replay added a medium-confidence quiet preparation in a
rook ending and displaced its important allowed-perpetual explanation. That
draft is rejected: the new path now requires high-confidence root evidence and
preserves established opponent causes. The private initial report remains as
contrary evidence. A test also initially used king-destination rather than the
stored rook-square castling notation; the frozen row was not absent.

The final 217-position replay changes exactly **one** full result: castling gains
the separate missed knight-capture lesson. The other 216 full results, all 246
prior private course source/live results and twenty rare-theme results remain
unchanged apart from versions/timing. None of those unchanged results is thereby
certified accurate. Median/p95/max computation for the owner replay's combined
source/live/review row is 64/225/519 ms, excluding engine and rendered UI.

- 2,316 selected tests pass, 158 optional skips, across 146 files. A separate
  final 48-test selection includes the actual owner capture and perpetual control.
- Twenty-four real React/Chrome desktop groups cover both alternative types,
  save/migrate, reveal/hide, three widths and 100/200% text. Screenshots were
  inspected. Phone flow explicitly checks its on-demand fresh MultiPV request.
- Two native wire/export tests, eight built-service checks (including actual
  Stockfish), two development-cache checks, TypeScript and frontend/service
  builds pass. Scoped lint has no errors; the phone-flow test retains its one
  pre-existing conditional-assertion warning.

- Twelve production-controller groups pass with thirteen optional groups skipped,
  including all 217 owner inputs and the existing public/control replays. All
  1,043 prior public primary lists are unchanged. The tested worker is
  `liveTactics.worker-Drwm4Atf.js`, SHA-256
  `8b70a99d6f091e56109bba06ba5c43374b79fc5799fa53dc5dc06a22eccc0034`.
- All 99 forced-cold HTTP cases pass. First/max startup is 4,794 ms and maximum
  computation/transfer is 1,313 ms. This run overlapped the production-worker
  suite; it does not erase earlier 19.7-second load-sensitive startup or prove
  native responsiveness. Seven `adapter114-worker-*.json` files and
  `adapter114-dev-cold.json` retain the exact receipts.

Owner games and detailed engine reports remain outside Git under
`Documents/OnCrescent Tactical Benchmarks/`. Relevant receipts include
`missed-alternative-capture-engine-20260916.json`,
`chesscom-recall-adapter114-{initial,final}.json`, `adapter114-tests-final.json`,
`adapter114-private-replay.json` and `adapter114-rare.json`.

Wider recall, conditional/long combinations, independently adjudicated accuracy,
alternative practice answers and native interaction/load-sensitive startup remain
open. Desktop delivery is recorded separately; this source milestone does not
restart an owner app or deploy a phone service.
