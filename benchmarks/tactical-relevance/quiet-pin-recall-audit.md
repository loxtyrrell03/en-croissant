# Quiet-pin recall: direct captures versus connected continuations

This is a follow-up diagnostic on adapter **155 / live pipeline 162**, already
packaged from source `b614387c`. It does not change classification, budgets or
runtime behavior. The same owner position is selected because its live root
was empty; this is development work, not a blind holdout or accuracy estimate.

## Chess finding

The reviewed **...Bb4** pins Nc3 to Ke1 and adds pressure beside Qb2. Replaying
every legal reply identifies **37 replies**. The existing liability-aware
direct-capture verifier supports a capture of that knight after 33 replies.
Four need another mechanism: **Kd2, Rd8+, Bd2 and Bd4**. A failed direct-capture
bound does not refute the whole move or prove this is a positional position.

Twenty-one fresh depth-16 Stockfish searches check those exceptions, selected
held captures and the exchange/checking route suggested by the previous audit.
They include deliberate repeated positions, not 21 independent examples:

- After **Bd2**, the old nominal route remains **...Bxe2 Kxe2 Nd4+**. All five
  replies to Nd4+ were searched: four remain winning and Ke3 permits Ng4#.
  Rxd4 concedes the exchange; other king moves permit queen captures or mate.
  Full-position scores do not independently certify each local payoff.
- There is a simpler alternative: **...Bxc3 Bxc3 Qc1+**, followed by taking Ng5.
  The held Bxc3 evaluates +596 cp for Black. The bishop which had blocked the
  c1-g5 diagonal leaves d2 to recapture on c3. The reached Qc1+ already receives
  an independently checked Fork from the classifier, but Bxc3 still has no
  proved first-move preparation. Its current preparation verifier normally
  requires the receiver to become the fork victim, or one of the separately
  verified defender/square-clearance mechanisms. This newly opened slider ray
  needs its own causal and all-defence check; allowing arbitrary later forks
  would restore the original noise.
- **Qxc3?** is not interchangeable with Bxc3: held Qxc3 after Bd2/Bd4 evaluates
  -131/-136 cp for Black, while held Bxc3 scores +596/+613. A queen sacrifice
  cannot borrow the bishop-capture line's compensation.
- **Rd8+** is a counterchecking rook offer. Nxd8 is independently classified
  Material Gain, with a 400-cp local bound; the engine's whole-position estimate
  is +743 cp. These are different quantities, not contradictory evaluations.
- **Kd2** keeps the knight pinned on b4-c3-d2, but the direct Bxc3 exchange has
  a -10-cp local bound. The engine prefers the quiet ...Nd4 continuation, and
  the held checking capture remains winning through other exchanges. This is
  not solved by merely adding the Bd2 ray-clearance branch.

The held Bxc3 fork after **Bd4** differs from Bd2: Bd4 has already vacated e3,
so the queen's diagonal need not be newly opened by its later recapture. Any
extension must distinguish this existing fork from a genuinely prepared one.
The root pin's complete connected explanation remains open; this audit does
not convert the empty result into a correct negative or promise a forced win.

## Reproduction and evidence

`src/utils/tests/quietPinRecallAudit.test.ts` accepts a private frozen replay,
case ID, target square and report destination. It enumerates every root reply,
records all legal direct target captures and their separate exchange/retention
bounds, and asks the existing capture-preparation verifiers for failure traces.
Promotion replies fail explicitly rather than silently omitting underpromotions.
Reports pass the shared private-path guard and cannot overwrite an existing file.

The opted-in 37-reply diagnostic and 21-search engine audit pass. TypeScript and
scoped lint pass. Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:

- `quiet-pin-direct155-20260917.json`: complete direct-capture inventory.
- `quiet-pin-connected155-20260917.json`: inventory plus preparation traces.
- `quiet-pin-decisions155-20260917.json`: exact fresh engine requests.
- `quiet-pin-engine155-20260917.json`: all 21 completed searches.
- `quiet-pin-ray-geometry155-20260917.json`: legal before/after Qc1+ replays
  confirm that Bd2-c3 opens the knight attack, while the Bd4 route already has it.

The initial and connected inventories agree on all 37 replies, capture values
and the four unresolved branches. The earlier 39-search root/reply audit is
retained separately and is not counted as fresh work here. No owner boards or
paid material are committed. No runtime, owner store or phone service changed
during this audit; clean desktop delivery is documented separately.
