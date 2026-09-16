# Checking pawn recall through allied support

Adapter **122 / live pipeline 127** recovers the remaining ply-42 Qxc6+
opportunity in the fixed six-game owner audit. This is a real recall improvement,
not completion of the wider classifier goal or a new independent-game sample.

## Chess judgement

The root takes a pawn with check. Against the queen interposition, exchanging
queens retains that pawn; the supplied Qa8+ continuation need not itself play
that exchange. Against the rook interposition, **Rd1** reinforces the pinned
rook. Subsequent queen checks can require king moves, which the earlier proof
rejected automatically. The other king evasions allow taking the rook.

The new local certificate covers all five root replies, using 1,559 operations
for the original checking nomination (1,564 for the explicit exchange) from
the unchanged 8,192-operation budget. It records selected defensive moves for
independent inspection. The minimum is **100 local cp**, not a whole-position
evaluation, a claim of another free piece, or proof of winning the game.
White is already losing in this owner position. The actual Qc8+ queen loss
remains the primary mistake; missing the pawn is secondary.

## General change and bounds

- A further check by the same piece can nominate an independently legal,
  equal exchange against the actual interposer. A quiet continuation or an
  unrelated queen liquidation cannot supply this nomination.
- A quiet allied move may newly attack the actual piece interposed between
  checker and king. The existing material, liability and countercheck tests
  still apply; this is not general admission of arbitrary quiet moves.
- Profitable captures and that connected support may answer checks with king
  flights. Every legal checking branch is examined through at most six further
  evasions. Quiet blocks inside the expanded search must also survive further
  checks. A repeated identical board, side, castling/en-passant state and
  material balance closes a material-retention cycle, not a winning certificate.
- Capture leaves retain the existing bounded exchange, off-square-liability
  and terminal/countercheck checks. Longer quiet attacks, repetition-history
  outcomes and unrestricted king hunts are not solved by this proof.
- King evasions are ordered by proximity to the original king square; ordering
  is not evidence of safety. Unknown/budget-exhausted branches still abstain.
- Ordinary exchange recovery, root-only inputs, terminal drawn trades and
  earlier unsafe checking-capture controls keep their existing restrictions.
  App deadlines are unchanged.

## Contrary evidence, not just passing outputs

The first king-walk draft selected f4 in an owner continuation; fresh Stockfish
found a checking deflection that then won the rook. That witness was rejected.
The final selected owner decisions match the fresh `owner-engine3` receipt;
the earlier contrary `owner-engine2` receipt remains private and is not replaced.

A constructed version without the f-pawn initially selected Qf2 (Qf7 reflected)
and permitted mate in four. Following quiet blocks through further checks now
withholds that certificate in both colours. Importantly, the **root itself is
winning** in the fresh engine searches: this is a corrected unsafe proof and
a remaining coverage gap, not a correct no-tactic position. Removing the allied
rook also still leaves drawing resources. An added bishop produces different
counterplay. The first bishop control illegally checked the king at the root;
legal replay caught it before the engine audit, and the corrected setup is used.

The constructed positive has a winning root estimate, but some selected
material-retention continuations draw. It establishes retained material, **not
preservation of the root's winning outcome or optimal defensive choices**.
The public receipt retains both rejected mating witnesses beside the final
selected decisions; positive decision checks permit draw estimates explicitly.

## Verification and receipts

The final fresh engine batches contain 71 owner and 150 constructed/reflected
depth-16 searches. Of the latter, 120 match the final nominated root/branch/
safety requests; the other 30 belong to the rejected no-shield certificate.
All 114 selected positive public decisions are non-losing finite-depth estimates
or winning mates. These are branches of constructed positions, not 114 games,
and Stockfish is corroboration rather than exact full-game proof.

The exact owner replay changes two of 339 contexts for this one opportunity.
The other 337 contexts, all 246 private course/generated-game results and all
twenty rare-theme results are unchanged excluding versions/timing. Unchanged
or empty output is not certified correct. The broad source selection passes
2,394 tests with 174 optional skips; types, scoped lint and shared-review/app
builds pass. Ten shared-service and two cache/recovery checks pass.

Private receipts under `Documents/OnCrescent Tactical Benchmarks/`:

- `checking-allied-retention-owner-probes5-20260916.json` and
  `checking-allied-retention-owner-engine3-20260916.json`;
- `checking-allied-retention-controls-final-20260916.json` and
  `checking-allied-retention-controls-engine2-20260916.json`;
- `adapter122-tests-final.json`, `adapter122-{private,rare}-final.json`,
  `chesscom-{recall,disjoint}-adapter122-final.json`.

Public evidence: `checking-allied-retention-stockfish-18.json`; owner FENs,
identities and paid course contents remain outside Git.

Twenty-one compiled-controller groups pass (thirteen optional skips), including
eight new constructed/reflected controls and all 339 owner scans matching
source. All 1,043 prior public primary lists remain unchanged. Computation/
transfer median/p95/max is 38/195/839 ms, excluding engine, startup and native
UI. Immutable artifact: `adapter122-worker/liveTactics.worker-BwUL3JD0.js`,
SHA-256 `5ad3965678a9c579fc51413fee9bad20a025f2a61434132f2633b13c2a548a86`.
Receipts are `adapter122-worker-{public,capture,discovery,preparation,game,drawing,
owner,disjoint}-final.json` and `adapter122-worker-tests-final.json`.

All 139 cold-HTTP cases pass in `adapter122-dev-cold-final.json`: first/max
startup 3,174 ms; maximum classification/transfer 1,274 ms. Server prebuild is
separate, 5,484 ms. This is not a fix or reliability certification for the
earlier twenty-second failures. A subsequent private opted-in focused run
passes 26 checks with four optional skips; scoped lint has no warnings/errors.
Desktop packaging is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.

Broader pawn/quiet-combination recall, rare-theme coverage and primary selection
remain open. No native-window interaction, reliable installed startup or phone
deployment is asserted; owner games, settings and services are unchanged.
