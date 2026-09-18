# Newly exposed pawns must not inherit unrelated old piece debts

Adapter **163 / live pipeline 170** restores a current safe pawn capture that
the historical relevance filter incorrectly erased. The preceding
`advanced-pawn-recall-audit.md` records the three newly sampled owner games,
the initial chess judgments and the exact older failure. This is a general
history-boundary change, not an owner-position exception.

## Chess and implementation

The owner's Bxe4+ wins a loose pawn after ...Nd6 makes Kxe4 illegal. The old
filter charged a bishop capture and subsequent unrelated material changes to
that pawn indefinitely. The current capture already passed the liability-aware
safety check; additional engine depth could not repair the historical veto.

The new fallback requires complete legal game history and a specific quiet
advance of that same previously capturing pawn. The present attacker must have
stayed on its square, with no intervening capture, promotion or check. Every
legal capture of the pawn on its old square is inspected independently; an
already profitable old-square capture prevents claiming a new exposure.
Pawn-for-pawn compensation remains charged, and earlier pawn profits cannot
finance the present gain. Current capture safety is still proved separately.
The old-square check is bounded at 4,096 operations; exhaustion is unknown.
No engine request policy or production deadline changes.

This recovers Bxe4+ as **Hanging Pawn**, with a 100-cp local bound, not a claim
that Black has a won ending. The fresh engine audit preceding this change put
the full position near -97 cp for Black. The actual move was Bxe4+, so there is
no missed opportunity. The preceding a6 was also the analysed best move:
review explicitly retains the same existing threat instead of blaming it for
creating a new one. A bad king reply can allow a later knight fork, but the
root does not acquire that conditional fork.

## Contrary controls and independent review

Constructed full legal openings exercise both colours, early exposure and
capture-free waiting. A pawn's earlier capture of an offered bishop no longer
erases a subsequently established safe capture. The constructed full positions
remain disadvantageous for the capturer despite that local pawn opportunity.

- Adding a pawn defender prevents the present gain.
- A quietly advanced gambit pawn still owes its original pawn; taking it back
  is not newly labelled a material-winning tactic.
- An earlier profitable capture by a different piece blocks the new-exposure
  boundary, even if the currently selected attacker could not take it then.
- Missing/truncated history, renewed exchanges and attacker relocations cannot
  use this capture-free certificate. These exclusions are not declarations
  that every resulting position is non-tactical.

Twenty-four fresh depth-18 searches inspect the positive and contrary boards.
Both early/waiting positive captures remain the preferred engine moves, with
held full-position scores from -177 to -101 cp. Defended knight captures are
roughly -395/-387 cp and permit the legal pawn recapture. Returning the gambit
pawn is sound (+132/+137 cp), but that does not make a pawn-for-pawn return a
new material-win lesson. The older-capturer control also has stronger queen
checks; neither its current pawn capture nor its old-square knight capture is
claimed to be the optimal full-position move.

An independent python-chess audit reconciles all 24 requests, 48 lines and 931
legal SAN/UCI moves. It replays the real owner's complete history and verifies
all four legal king replies to Bxe4+, including the illegality of Kxe4.
Draft controls that blocked their own bishop move or introduced an unrelated
compensating capture were rejected; the final tests use legal guarded-pawn and
exchange examples.

## Verification and scope

The frozen **33-game / 1,704-context** source replay changes exactly two related
rows: the live Bxe4+ capture and its preceding existing-danger review. The other
1,702 full results, all 246 private course/generated-game results, and all twenty
rare-theme results remain unchanged apart from version/timing. These are full
result comparisons, not just primary IDs. Stability is not independent accuracy.

- Broad selection: **2,948 passes / 360 conditional skips across 213 files**. The two former
  expected failures for waiting-pawn persistence are now ordinary passing tests.
- Sixteen opted-in history/owner/probe checks pass separately. Both-colour
  saved-review/deck/reload cases pass in the generated service, within its
  **38 passes / one optional engine skip**. Controlled service scores test
  transport and ownership, not independently scored full-game mistakes.
- **36 actual React/browser-worker groups** cover positive, defended and
  gambit-return positions at 1100/760/360px and 100/200% text, keyboard preview
  activation, exact root arrows and overflow checks. Screenshots are retained
  under `tmp/tactical-advanced-pawn-pipeline170/`.
- Whole-project/review TypeScript, scoped lint, review/frontend builds and two
  dev-cache recovery tests pass. The dirty-checkout frontend is not the clean
  desktop delivery source.
- All **2,518 compiled-controller inputs** pass: 808 public, 1,704 owner
  contexts and six new history controls. Every owner scan matches both its
  frozen source result and an independent source recomputation.
  Every prior public primary list remains unchanged; compute/transfer
  median/p95/max is **40/209/1,139 ms**, excluding engine and native UI.
- All **207 cold HTTP cases** pass the unchanged startup/computation deadlines.
  First/max worker startup is 1,293/1,621 ms, max compute/transfer 1,170 ms;
  server startup/prebuild is a separate 3,335 ms.
  Passing development runs do not resolve earlier load-sensitive failures or
  establish native reliability.

Private receipts are under `Documents/OnCrescent Tactical Benchmarks/`, using
the `advanced163-` prefix; original owner material remains outside Git.
Clean desktop delivery is recorded separately.
No owner stores are rescanned, and no app or phone service is restarted.

## Remaining gaps

This fallback intentionally does not reset history simply because time has
passed. Checking/capturing intervals, moved attackers, other old compensation
relationships and broader quiet preparations still need evidence-specific
handling. The full Bxa6 combination/causal explanation, Re8+ saving resource,
mixed quiet/long-mating Bd7+ branches, broader primary-theme judgment and
native/load-sensitive startup verification remain incomplete. This milestone
does not turn empty classifications into certified negatives or finish the goal.
