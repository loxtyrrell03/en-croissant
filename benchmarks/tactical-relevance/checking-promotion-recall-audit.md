# Checking defences before promotion: real-game recall audit

This preserves the diagnostic milestone at adapter 158 / pipeline 165; production
classification was unchanged at that milestone. The subsequent
`checking-promotion-review.md` records its adapter-159 integration and validation.
The packaged immediate-promotion improvement is recorded in
`promotion-threat-review.md` and `docs/TACTICAL_DESKTOP_DELIVERY.md`.

## What was actually missing

The owner's ...h2 is not refuted by Ra6+. That check delays promotion and
allows the rook to challenge the promotion file. A next-turn-only promotion
rule cannot explain the root, despite fresh engine support for the pawn push.
Nineteen easy root replies do not justify ignoring the checking twentieth.

The opt-in `promotionCheckPreparationAudit.test.ts` tries complete defensive
trees before promotion, rather than borrowing the engine PV. It permits up to
two checking defences, with a legal evasion after each; every quiet reply must
allow a retained promotion of the original pawn. Captures and opposing
promotions are debited. Earlier captures cannot inflate the promotion's own
retained gain. All nested promotion checks share a 32,768-operation allowance;
failed nested work is charged its whole reserved allowance.

The final real-game tree selects ...d6 against Ra6+, blocking the rook's ray;
Rxd6+ is answered by ...Nxd6. It covers twenty root replies and another 35
replies at two reached defender nodes. Its minimum local promotion bound is
380 cp, using 3,616 charged operations. This is not a whole-position evaluation
or a mate proof. All 55 selected decisions have fresh depth-16 engine searches;
their minimum finite side-to-move estimate is +613 cp, with no losing/mating
refutation in those searches. These searches do not make the local proof an
unbounded endgame solver.

## Contrary controls and independent checking

Three constructed geometries, each in both colours, distinguish:

- A guarded promotion which survives checks: local 400-cp gain in both colours.
- Removing the guard: exchanging or collecting the pawn defeats this promotion
  certificate; fresh held-root estimates are approximately equal, not winning.
- Moving the defender's rook onto the pawn's arrival rank: Rxh2/Rxh7 removes
  the pawn immediately; again no promotion certificate is accepted.

The final public engine audit contains 98 fresh searches: twelve root decisions
and 86 selected tree decisions. All selected positive decisions remain winning
in those searches, with a minimum finite estimate of +502 cp. Together with
the owner decisions, this is **153 final fresh searches**, not 153 puzzles.
Earlier overlapping 55/117-search drafts are retained but not added to this
final count.

The independent python-chess verifier checks three completed trees containing
141 reply edges: root and internal all-legal-reply coverage, check-evasion
legality, same-pawn promotion, board identity and pre-promotion material balance.
Deleting a root or internal reply must fail. It does not re-prove the existing
TypeScript promotion-leaf retention or solve the whole ending. An initial FEN
comparison failed on an unusable en-passant square after a double push; the
verifier now normalizes only non-actionable EP while retaining legal EP,
placement, turn, clocks and castling identity.

## Search-order findings and integration boundary

Earlier checks-first ordering exhausted the full budget on the unguarded
control before reaching its simple quiet defence. Quiet-first ordering avoided
that but raised positive-case work. The final prototype orders pawn captures,
blockades and promotion-square pressure before checks, then other quiet moves;
geometry orders work only and never proves a theme. Colour-relative ordering
gives the reflected positive controls the same strategy and 1,900-operation
cost. Failed negative nested promotion attempts still reserve substantial work.

Simply increasing depth is not a solution: the real depth-two tree succeeds,
while the depth-three/four trials exhaust the same global allowance before
finding a complete strategy. A production extension must preserve already
completed shorter proofs, share its budget with immediate checks, and remain
within existing worker limits.

Ten opted-in diagnostic/control tests, TypeScript and scoped lint pass. The
independent tree checks and both final engine audits pass. This is a concrete
route for recovering the real miss, **not a shipped new root label**. Before
production admission, the result still needs root wording, actual-ply payoff
linking, missed/existing-danger comparisons, broader source/owner/worker replay
and clean desktop delivery. It must not paint the trial's future evasions on
the starting board or attach an unverified engine continuation to its proof.

Authoritative private receipts use `checking-promotion-preparation158-` under
`Documents/OnCrescent Tactical Benchmarks/`, dated `20260917`: `prototype-final4`,
`public-final4`, `engine-final4` and `public-engine-final4`. Earlier drafts remain
separate. Owner-game material stays outside Git. No app, owner store or phone
service changed in this audit; source `dcbe0777` remains packaged. Broader
recall, primary-theme accuracy and native/load-sensitive reliability remain open.
