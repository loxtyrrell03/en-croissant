# Live targeted tactical candidates — pipeline 137

Adapter 131's motif proofs are unchanged. Live pipeline 137 connects the
previously benchmarked nominator to the native engine, scan lifecycle, worker,
cache and board preview. This recovers moves excluded before classification;
it does not relax the proofs or certify broad accuracy.

## Production behavior

The normal three-line depth-16 search remains. On its completion, up to eight
legal geometric/capture nominations outside those roots receive one restricted
depth-16 search, returning at most two additional options. Both searches share
the original six-second allowance after the engine's first response. A partial
main fallback does not start extra work. Failure, timeout or cancellation of
the optional search cannot replace a usable main result with a red error.
Incomplete extra work is stated beside the retained result.

Native `searchMoves` is optional for existing callers. Lists are validated as
independent legal roots after the played prefix, normalized for castling and
bounded to eight; invalid, empty, duplicate and injected commands are rejected.
Completion uses the restricted root count, so one root cannot wait for a second
MultiPV line. Native events include search provenance; queued main-search
events cannot impersonate supplemental evidence on the same board. Cancellation
continues to own the original request/process.

Additional options require a fresh sufficient-depth score, legal unique root
and normal full-position score/motif checks. They are not presented as fourth
or fifth unrestricted engine ranks. A proved immediate additional theme can
become the default preview when the main line has none; the engine's first
choice stays available. If that main line already has a high-confidence
immediate lesson, substantially weaker extra wins are omitted using the
existing 80-cp close-choice tolerance. Existing main-search alternatives are
unchanged. Quiet principal lines retain the broader winning-outcome admission.

## Real-game findings and contrary evidence

There are 152 fresh benchmark engine searches: seventeen over nine existing
public judgement boards, one constructed control and one reused owner board;
plus 135 across all 92 frozen August move contexts from two owner games.
Another four searches exercise the actual Rust engine process, unrestricted,
one-root, two-root and unrestricted again. None is a held-out accuracy set.

The full-game comparison uses each position's same freshly searched main
inputs, with and without supplemental candidates, and includes complete game
history. It does not attribute changes caused by fresh engine lines to this
patch. Two formerly empty principal explanations are recovered:

- The reviewed knight position gains **Nxc7's rook fork**, with **Ng5's
  discovery/pin preparation** as a separate option. Local bounds are 270/250 cp;
  whole-position engine estimates are +93/+74 versus the unrestricted +139.
  These are two alternatives in one position, not independent new games.
- **Qxg2** gains a Hanging Pawn lesson. The g2 pawn has no immediate legal
  recapture; Qf4+ is real counterplay, not a refutation of the retained pawn
  bound. The held full-position estimate is +672 versus +642 for the main
  Nbc6 search. The independently searched scores are estimates, not a claim
  that the restricted move is conclusively the best choice.

The initial integration also offered Qxg2 one move later, when **Bxa4+ wins
the queen**. Both engine scores were winning (+643 versus +931), but that did
not make the pawn option useful beside the direct queen capture. The final
relevance rule removes it and two other inferior unthemed candidate entries;
the same-input main explanations stay unchanged. The original draft receipt
is retained. Final extra themes occur only in the two recovered contexts;
five other contexts retain scored extra moves without inventing theme cards.

Quiet Italian Bxf7+ is geometrically nominated but rejected by its engine
score. Initial-position, Ruy Lopez and drawn-pawn-ending controls remain empty.
Removing both a-pawns from the discovery layout opens ...Ra1+: the constructed
Nd8/Ng5 results retain medium-confidence pin threats, not guaranteed material
gain. Their qualified result is not promoted to an immediate verified headline.

## Verification and receipts

- 115 focused source/controller/React checks pass, including the opted-in
  92-input exact replay. TypeScript and nine-file scoped lint pass. The native
  five-test selection passes, including the four real-engine searches above.
  An initial native test incorrectly serialized a deserialize-only request;
  it was corrected to test input decoding and event serialization.
- The compiled production worker/controller passes all 92 final owner inputs,
  the eleven fresh judgement inputs and twenty existing rare-theme inputs.
  Rare inputs are regression parity, not new restricted-search coverage.
  React checks cover annotations, main/extra previews, incomplete results and
  late/cancelled searches; no browser automation or native window was used.
- Main-worktree frontend build passes (8,877 modules, including unrelated local
  changes); it is not the desktop delivery source. Tested final worker is
  `liveTactics.worker-DbhzHW8n.js`, SHA-256
  `4a7526e8cc31eb14b6f5c074b1d8afb103fe625d3efbae3d6ab82779847373f5`.
  Desktop delivery must use a clean committed checkout and match these bytes.
- In the 92-position engine run, main process/search median/p95/max is
  645/1,525/3,533 ms; extra search across all positions is 0/660/978 ms (zero
  means no search was nominated). Exact source replay compute is
  45/288/1,507 ms. These exclude native UI and HTTP worker startup; simultaneous
  build load and separate engine processes mean they are not app latency claims.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:

- `targeted-candidate-live-20260916.json` — eleven fresh judgement inputs.
- `targeted-candidate-august-live-20260916.json` — full fresh-engine draft.
- `targeted-candidate-august-final-20260916.json` — final exact-input replay.
- `targeted-candidate-august-worker-final-20260916.json` — compiled controller
  results and artifact identity.

Owner positions and paid-course material remain outside Git. The original
prototype and rejected six-line width experiment remain documented in
`targeted-candidate-review.md`.

## Limits and next work

This changes the live tab, not automatic targeted candidate acquisition in
mistake review. Review can still miss a cause absent from its supplied engine
candidates. The nominator is bounded and does not propose every quiet,
endgame or long-preparation move; genuine omissions remain. Ng5's generic
Quiet Preparation headline still merits a more specific primary explanation.
Local material bounds do not prove general positional compensation or king
safety. Broader independently judged accuracy and native/load-sensitive startup
remain open. Existing cold-start failures are not resolved by these checks.

No owner app was started/restarted, no shortcut, games, settings or phone
service was changed. Clean desktop packaging is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. This milestone does not complete the goal.
