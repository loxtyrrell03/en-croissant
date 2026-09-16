# Older pawn opportunities with complete exchange history

Adapter **128 / live pipeline 133** extends ordinary capture recall beyond the
immediately preceding move. A safe pawn capture can remain relevant for several
turns. The new rule uses the complete game prefix to distinguish that opportunity
from returning a gambit or completing an exchange. It is not a general proof of
positional compensation, complete tactical coverage or perfect headline selection.

## Recovered lessons and chess judgement

The same eight frozen owner games contain 420 pre-move contexts. Exact replays
reuse the adapter-127 engine inputs; this is not a new or held-out sample.
Six principal live headlines change, eleven retained candidate variations gain
an immediate capture lesson, and sixteen full rows change including adjacent
mistake-review contexts. Repeated pawn opportunities and alternatives are not
independent tactical discoveries. The other 404 full rows are unchanged after
excluding history/version/timing metadata, not certified correct.

- **Qxd4** gains the initially loose pawn even if queens are exchanged next.
  The earlier bishop-for-knight trade is included without funding a larger
  current gain. Its preceding mistake gains the allowed-pawn explanation while
  preserving the separate missed pawn opportunity.
- **Qxg7, dxe4, Nxf2, Rxh7 and Bxc4** recover immediate pawn lessons. Several were
  actually played, so they do not become missed-move accusations. A predecessor
  which was the engine's best move stays existing danger. Unsupported causal
  comparisons remain explicitly neutral.
- **Bxa3** gains a separate missed alternative, with the local compensation-aware
  bound of 90 cp. Earlier captured material cannot inflate that value.
- **Nxf5** is a pawn-taking alternative, not a claimed winning position. After
  ...d5, Ng3 can retain the extra pawn while Black has central/development
  compensation. Nine fresh depth-16 decisions include Nxf5 (-55 cp White),
  the retreat (-56), the central e4 choice (-34), and the bad Nh4 (-461).
  The supplied e4/Bxf5/exf5/Qg5 line returning material is therefore not itself
  proof that the pawn cannot be retained. The better e4 root remains principal.
- **Nxe4** in the other opening is an immediate loose-pawn opportunity, not a
  promise of remaining a pawn ahead indefinitely. White can later trade a bishop
  for the defending knight and recover a pawn; Black retains the bishop pair.
  Fresh held Nxe4 scores +69 cp Black and the checked ...Nf6 response +103.
  Whole-position engine estimates are not the 100-cp local capture bound.

Long mating evaluations cannot acquire a generic pawn lesson through this new
route. Existing mate, perpetual, larger-loss and comparable-capture priorities
remain in place. No lower score threshold is used to hide opportunities merely
because the capturing side is losing overall.

## Complete-history contract and limits

Live scans walk the selected tree variation once, excluding all future moves.
Native scans record every played move before analysis/side/time filters can
skip it. Shared phone/background cards retain the same prefix; saved schemas,
motif/nature readers, migration and cache identities preserve it. Old cards
without that evidence remain conservative until reanalysis; progress is not reset.

The transport keeps the origin FEN and at most 1,024 complete plies, never a
truncated suffix. Admission replays every legal move and matches the exact target
position, including clocks. The origin must contain every original piece and
all eight pawns per side, establishing that no earlier capture/promotion debt
was omitted. Reduced-material setup FENs cannot use this new rule; their existing
theme mechanisms are unchanged. Piece identities survive castling (both UCI
notations), en passant and promotion. A small bounded replay cache is keyed by
the entire prefix, not just the target board.

For the exact capturer and target pawn, the rule traces the last point where
the legal capture was unavailable and includes the pawn's earlier capture debt.
The signed exchange balance must leave at least the existing 90-cp threshold
when combined with the independently checked current gain. Earlier material
cannot increase the displayed gain. Current safety still uses the existing
4,096-operation all-friendly-liability/countercheck leaf. There is no increase
to worker or engine deadlines, and no new online request.

The earlier sixteen-ply experiment remains rejected: its truncated Catalan
history falsely erased ...dxc4. The new production path rejects that exact class
of incomplete origin. Petroff/Catalan recovery controls remain unlabelled, while
a separate pawn after a settled bishop/knight trade is retained. Exchange-history
relevance is bounded policy, not an exhaustive account of strategic compensation.

## Verification and delivery

The broad source selection passes 2,467 tests with 195 optional skips. The fixed
246 private source/live results and twenty rare-theme results match adapter 127
apart from versions. Thirty-six actual React/browser-worker groups cover both
colours, positive captures and delayed-recovery controls at 1100/760/360 px and
100/200% text. The real panel-selector test verifies the selected prefix reaches
the worker; five native tests cover the wire contract and related existing paths.
TypeScript, scoped lint, the 43-module generated review service and frontend build
pass. All 26 selected compiled-worker groups pass, including the six new public
history controls, followed by 420 exact owner source/controller matches. All
1,043 earlier public primary lists remain unchanged by input identity and lane;
their computation/transfer median/p95/max is 39/191/1,107 ms. Owner computation
is 89/320/1,275 ms, with at most 748 bytes of additional history in this sample.
These timings exclude engine search, startup and native UI; no speedup is claimed.
All 180 cold-HTTP inputs pass, but first/max startup is 7,967 ms, still materially
slow. Maximum computation/transfer is 1,319 ms. Eleven generated-service tests
(including complete-history save/reload) and two worker-cache tests pass. The
tested immutable worker is `liveTactics.worker-Bu9tBM3T.js`, SHA-256
`00399ed7454504fde61f54aa77925c101921baaeb9873e2851ba76b77d770941`.
Desktop delivery is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`;
source/browser/package checks alone are not native interaction or startup proof.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`:
`chesscom-{recall,disjoint,third}-adapter128-history-initial.json`,
`persistent-pawn-retention-{probes,engine}-20260916.json`,
`adapter128-tests-initial.json`, `adapter128-private-initial.json` and
`adapter128-rare-initial.json`. The nine fresh decisions complement the prior
75-search capture inventory, not nine new independently selected positions.
The initial source-test input used the wrong score field and its live variant
omitted the scored variation; both harness mistakes were corrected. The first
browser launch also exposed a fixture's Node-incompatible extensionless import;
the fixture now replays using chessops directly. No production expectation was
weakened to accept those failures. Paid course and owner boards remain private.

Broader quiet preparation, full-history-free pawn recall, longer counterplay,
primary-mechanism judgement, representative accuracy measurement and historical
load-sensitive/native-startup reliability remain open. Phone-runtime deployment
and native-window interaction are not implied by source/shared-service changes.
