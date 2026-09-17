# Independent pawn opportunities without exchange-funded noise

Adapter **152 / live pipeline 159** separates the history of a pawn which has
never captured from unrelated piece exchanges. A local pawn opportunity is no
longer rejected merely because a queen or minor piece was lost elsewhere.
Conversely, winning an unrelated piece cannot finance a new pawn-gain claim.

## Chess judgement and resulting changes

The reviewed owner Nxc7 takes an untouched c7 pawn and attacks the rook on a8.
That is a pawn opportunity with tempo, not a fork of two pieces. The old recent
history balance included a queen loss on a8 and suppressed the independently
checked 100-cp capture. Fresh depth-18 searches prefer Nxc7 (+754 unrestricted,
+742 held); these are full-position estimates, not its local pawn certificate.
White was already winning. Played g6 (+681 held) still permits Nxc7 after the
analysed ...hxg6, so the recovered live lesson does **not** become a missed-pawn
accusation. The preceding ...Rxa8 was also the engine's best move: the new
opponent lesson explicitly says the danger persists, not that ...Rxa8 caused it.

Two further owner positions recover dxe6 and ...Qxd4+ as close alternatives
when the principal line has no supported immediate lesson. The latter was
actually played and receives no missed-opportunity accusation. One older Qxa7
alternative loses its generic pawn label: it offsets an earlier pawn loss,
and an unrelated piece gain must not make that reciprocal capture a new win.
Its unproved principal checking preparation remains a coverage gap.

The complete 27-game, 1,319-context exact-input replay changes **five rows**:
three recovered live primary lists, one removed alternative, and one qualified
opponent-position lesson. These are overlapping contexts, not five recovered
tactics, and no overall accuracy percentage is inferred. All 246 private
course/generated-game and twenty rare-theme full results remain unchanged
apart from version; this is regression stability, not certified correctness.

## General rule and rejected draft

- Complete original-material history must replay to the exact board. The
  unchanged identity tracking establishes whether this target pawn ever
  captured, including en passant. Missing/truncated histories cannot qualify.
- For a never-capturing pawn, recent pawn exchanges remain relevant. Piece
  gains/losses elsewhere neither credit nor debit that pawn opportunity.
- Contiguous same-square captures are accounted together. A bishop exchanged
  for a pawn settles that chain's pawn cost; it cannot export its surplus to
  offset some other pawn debt. Positive pawn credit is also capped by that
  chain's retained net material, not an offered piece's nominal pawn capture.
- A pawn which did capture retains the full existing material ledger. Delayed
  Catalan recovery and recapturing a pawn which took an unrecovered knight
  therefore remain excluded. Petroff reciprocal pawn recovery also stays out.
- Current liability/recapture/countercheck proofs, proof budgets, engine work
  and worker deadlines are unchanged. Historical credit never increases the
  displayed local capture value or proves a winning full position.

The first draft ignored all piece entries. Whole-game replay caught its false
debt after Bxg4 Nxg4: the pawn had already been traded for a bishop. That draft
incorrectly removed a later Nxf2 lesson and is **not** the shipped rule. The
final same-square settlement restores that result unchanged. Constructed
both-colour controls reproduce unrelated queen loss and unrelated queen gain;
their earlier drafts exposed a hanging knight and were corrected rather than
weakening the local safety requirement. Adding ...d6 refutes the proposed Nxe5.

## Verification and evidence scope

There are 57 completed fresh Stockfish searches: fourteen initial owner
decisions, 35 changed/draft-control decisions, and eight public constructed
decisions. Some are deliberate repeat searches of the same roots, not
independent positions. The public receipt is `independent-pawn-stockfish-18.json`.
The constructed independent captures remain useful local pawn opportunities
in losing positions (held -692/-715 cp); the reciprocal controls remain
winning overall (+716/+711 cp). Neither sign decides the tactical label.

The selected source suite passes 2,766 tests with 324 conditional skips.
Subsequent focused source/React checks include the new public engine replay and
private owner assertion, then an additional separate-pawn-debt control. Type checking,
scoped lint, 27 generated-service checks (one optional engine skip), and
review/frontend builds pass. Shared review tests complete legal opening
histories, both missed and still-available opportunities, saved cards/decks
and reload. Static React checks the current-ply pawn wording without importing
the old queen loss; it is not native interaction proof.

Private receipts use the `independent-pawn-` prefix and `20260917` suffix in
`Documents/OnCrescent Tactical Benchmarks/`. `owner152-final`, `private152-final`
and `rare152-final` are authoritative; the retained draft owner report includes
the rejected Nxf2 suppression.

The production worker/controller passes **2,159 inputs**: 808 public, all 1,319
owner contexts, four new constructed controls and 28 retained exchange/fork/
capture controls. All previous public primary-ID lists are unchanged; every
owner result matches source and the final replay. Public computation/transfer
median/p95/max is 44/202/1,110 ms, startup max 36 ms. Owner figures are
96/417/2,152 ms, startup max 36 ms. These Node-host timings exclude engine
search, development HTTP startup and native UI. The initial new-control harness
omitted the engine score's real variations wrapper; source and worker correctly
agreed on abstention. The corrected four inputs pass with the production shape.
No runtime limit was increased.

Tested artifact: `liveTactics.worker-CZXAGH3t.js`, 598,352 bytes, SHA-256
`5a007e62968ac1561f71a4f21da88537e2da9dc095f45409e05bd2d5637bb7a4`.
Clean desktop delivery is recorded in `docs/TACTICAL_DESKTOP_DELIVERY.md` when
complete; this source milestone does not itself claim native interaction.

This is a relevance/accounting correction, not a complete history-based
exchange or positional-compensation model. Quiet preparations, longer tactics,
comparable-capture mistake causes, the known queen-ending promotion and
representative independently judged accuracy remain open. Native interaction
and load-sensitive startup are not certified. Owner and paid data stay private.
