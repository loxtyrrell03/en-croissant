# Fresh owner-game audit: a pawn opportunity erased by old exchange history

Adapter **162 / live pipeline 169** is unchanged. Three further whole games
expose a concrete recall defect in the historical relevance filter, rather
than a failure to prove the present capture. This milestone adds evidence and
reproducible known-gap tests; it does **not** claim the defect is fixed.

## Selection and chess review

The next three eligible June games were selected by descending end time,
excluding all twelve previously sampled June games. All **153 plies** remain,
without tactical/evaluation filtering. Initial board and move-sequence judgments
preceded engine/classifier output. They cover selected decisions, not an
independent exhaustive label set for every board.

There are 153 fresh depth-16 MultiPV searches. The full corpus now comprises
33 games / 1,704 contexts; the earlier 1,551 engine/classification inputs are
reused unchanged, not newly searched. Owner games and identifying details remain
private under `Documents/OnCrescent Tactical Benchmarks/`.

The new sample correctly explains reviewed queen losses, exchange wins,
checking forks, a promotion with discovered check and short mating attacks.
Routine development and equal minor-piece exchanges often remain unthemed.
Its 46 immediate headlines, one continuation-only headline and 106 empty
initial headlines are **coverage counts, not accuracy counts**. Three empty
initial previews already list classified alternatives in the actual component;
they are not positions where every candidate is unclassified.

Initial judgments required correction:

- A knight geometrically able to take a newly promoted queen cannot legally
  do so: promotion uncovers a rook check along the seventh rank. The existing
  Discovered Check primary is appropriate; the legal defence takes the rook
  instead, with compensation retained.
- Ng6 attacks a queen, rook and bishop, but a checking queen exchange followed
  by a rook retreat escapes the apparent material fork. Held Ng6 is about
  +107 cp versus +412 for the preferred move. Geometry and the actual game
  continuation do not establish a forced fork payoff.
- Bxf3+ is an approximately equal bishop/knight exchange by itself, not a free
  minor piece. In two later contexts it precedes a genuine rook collection;
  the different king/rook/pawn replies require connected explanations. Those
  first-move explanations remain incomplete. Direct rook captures are already
  classified alternatives. Their fresh scores (+580 versus +745 and +808
  versus +882) do not justify silently calling them the engine's first choice.
  No default-selection threshold was changed in this audit.

## The concrete missing pawn

In the reviewed ending, **Bxe4+** is legal and has a current liability-aware
local gain of 100 cp. The same-square exchange also yields 100 cp. Nevertheless
the persistent-pawn filter assigns a historical balance of **-630 cp across
19 plies**, including a prior bishop capture, rook capture and unrelated
promotion. The victim pawn previously captured a bishop, so it enters the
complete-material-ledger path rather than the independent untouched-pawn path.
Consequently the live root is empty even though its current gain is established.

The timing matters. Before ...Nd6, Bxe4+ permits Kxe4 and loses a bishop for
a pawn; its fresh held score is -512 cp. ...Nd6 guards e4, preventing that king
recapture. After the actual quiet reply, Bxe4+ is the engine's preferred move,
about -97 cp. All four legal king replies were separately searched. One bad
king reply permits a later knight fork; that conditional fork must not become
the starting position's explanation.

This is a **local pawn opportunity, not a won ending**. The alternative ...g5
also retains a later Bxe4+ capture, and the move actually played was Bxe4+.
Recovering its live label must not invent a missed opportunity or blame the
preceding move for an already existing threat.

The general issue is that a pawn's old capture can keep unrelated subsequent
material changes attached to it long after a new capture opportunity develops.
Increasing search depth/node budgets cannot fix this: the current capture
already passes. A blanket removal of history would reintroduce ordinary
recapture/gambit-return noise, so that shortcut was not applied.

## Reproducible constructed coverage gap

`advancedPawnHistory.ts` contains a legal constructed opening, not an owner
game. A pawn captures an offered bishop, then advances to a loose square.
The classifier initially identifies Nxe4 as Hanging Pawn. After four
capture-free waiting plies, the identical safe capture disappears because the
old bishop deficit is still charged to the pawn.

Both colours retain the same 100-cp local gain. Eight fresh depth-18 searches
prefer the capture in both early/later boards; full-position estimates remain
negative, approximately -101 to -182 cp, rather than a claim of winning games.
Two `test.fails` assertions explicitly retain the desired persistence as known
coverage failures. They are **not successful negative cases or fixed defects**.

The next production change must establish a defensible opportunity boundary:
keep ordinary and delayed recapture compensation, but stop unrelated historical
material from erasing a newly established safe pawn capture. It must handle
both the quiet-advance persistence example and the actual allied-guard example,
then recheck missed/allowed semantics and the full existing corpus.

## Verification and delivery boundary

- The new opt-in capture diagnostic examines all 33 admitted engine-candidate
  captures with empty immediate classifications, retaining their current
  exchange/safety values, history balances and complete legal reply sets.
  These are candidates for review, not 33 certified missed tactics.
- **42 fresh depth-18 follow-up searches** supplement the 153 root searches.
  An independent python-chess checker reconciles exact requests, held moves,
  all 153 actual game plies, 96 returned lines / 1,755 legal moves, all fourteen
  defences of three selected checking roots, and the promotion correction.
- All **153 new compiled-controller inputs** match source, using the existing
  packaged worker `liveTactics.worker-C2ZW4Ms6.js`, SHA-256
  `29d4e678f19d37002a652dc702ccdeab5740ae60255f7b955b1c00fcba4d76ab`.
  This is runtime parity, not independent chess accuracy or native UI proof.
- Final focused history/capture/selection checks: 83 passes, two explicit
  expected coverage failures and ten conditional skips. Seven sampler tests,
  whole-project TypeScript and scoped lint pass. The opt-in diagnostic and
  actual-worker replays also pass separately.

Private receipts dated `20260918` use `chesscom-june-fifth-`,
`june-fifth-`, and `advanced-pawn-history-` prefixes. The exact concatenated
next baseline is `owner33-adapter162-{sample,baseline}-20260918.json`.
The initial notes preserve mistaken hypotheses instead of rewriting them after
seeing the engine. No owner store was rescanned, no app/service restarted,
and no package replaced. The existing adapter-162 desktop remains as recorded
in `docs/TACTICAL_DESKTOP_DELIVERY.md`; wider recall and native reliability
remain open.
