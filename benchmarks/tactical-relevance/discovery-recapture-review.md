# Discovery recovery through connected exchanges

Adapter **149 / live pipeline 156** extends discovery proofs through checking
recaptures and captures which open a participating pin or support ray. The
owner-game audit uses the same 1,319 contexts in 27 games as adapter 148,
with the same engine inputs and complete supplied history. It is a development
comparison, not a new sample or an accuracy benchmark.

## Chess outcomes, including contrary results

- **Bc3** now explains a discovered attack: the bishop attacks the queen while
  vacating a file for its own queen. A central pawn can be retained after the
  queen escapes. White is already materially worse; the local 100-cp bound is
  not a claim that White wins the position. The opened queen file is relevant:
  after ...Qa1, taking e5 with the bishop would allow ...Qxe5, whereas Qxd5
  uses the discovered attack. After ...Qa2, Bxe5 is the selected safe capture.
- **Ng5** gets the more specific Discovered Attack instead of Quiet Preparation:
  the knight vacates the rook's file. Existing danger is not newly blamed on
  the preceding move merely because the position lesson improved.
- **Rf6+** gets its immediate Discovered Check. This is a useful material-saving
  mechanism in a roughly equal whole position, not a forced win. A separate
  earlier context retains the same mechanism only at ply 5.
- **...Nxd4** now leads with Discovered Attack instead of an alternative pawn
  capture. After the bishop's checking exchange, the rook recapture can be
  followed by a pawn capture opening a connected pin or supporting the knight.
  The previous adapter-148 pawn-counterattack recovery remains intact.
- One **Nxf7** context loses its fuller Fork explanation and retains only the
  immediate pawn gain. The root is still winning according to fresh Stockfish;
  this is a known explanation/recall gap, not a correctly rejected tactic.
  ...Nc4 attacks the queen. Quiet queen-repair trials remain incomplete:
  Qa4 meets ...b5 and Qb4 meets ...a5, each demanding another answer. No
  diagnostic nomination was promoted to a production proof.

Exactly 21 owner rows change somewhere in their full result; six change their
live primary ID list as described above. These are not six newly solved
positions. In particular, one change is a later continuation and one loses a
useful explanation. The ...Nxd4 missed-move comparison also remains imperfect:
the played pawn capture has comparable immediate material. A local one-pawn
discovery certificate alone does not establish why the engine prefers the
other move. Broader causal qualification is still required.

Of 246 private course results, 244 full results are unchanged. One changes
only its later fork wording. Another gains a conditional ply-5 Ng6 discovery;
its starting move still has no verified immediate explanation. All twenty
rare-theme full results are unchanged. Neither unchanged nor empty outputs
are counted as correct negatives. Paid inputs and owner records stay private.

## Proof changes and safety boundaries

The existing discovery proof runs first. Only after failure may recovery use
what remains of its original **4,096 operations**; there is no added allowance
or longer deadline. Recovery can retain earned material, capture a checking
piece, or connect a capturing clearance to a newly opened participant pin or
support ray. The pin must involve an original victim, and an already present
identical pin does not qualify. Opponents capturing an ally can become concrete
recapture targets, but unrelated loose pieces cannot finance the lesson.

All legal defences must have an admitted answer. Leaves debit friendly-piece
liabilities and counterchecks. A newly added safety check handles a countercheck
answer which leaves two separately profitable capture targets: each capture
needs a legal repair before the next material bound. This is one additional
material response, not full quiescence or proof against longer king hunts.

Fresh engine review rejected a draft ...Nxd7 answer: Bxe7, ...Bxe7 and Kxe2
remove two pieces sequentially, which the previous single maximum liability
missed. The corrected certificate selects ...Qxd7 and checks the repair branches.
The successful receipt is separate from the failed 125/516-search draft.

The immediate-fork verifier now accepts a collection already sufficient to
retain the initially captured pawn without wasting its budget trying to prove
an unnecessary extra gain. An older Rxe4 fork remains valid when Rd4 forces a
rook exchange. Its wording no longer says that this wins a forked rook outright.
The initial suspicion that this whole fork was false was rejected after checking
the committed baseline; it was a budget regression plus misleading wording.

Test colour reflection now swaps castling rights and reflects en-passant squares.
An earlier invalid reflected castling entitlement caused an illegal engine PV;
the partial 438/544-search receipt is retained, not counted as verification.
The engine harness now rejects such parse errors directly instead of producing
an uncaught exception followed by a misleading timeout.

## Verification

The final source selection passes **2,734 tests**, with 314 conditional skips,
including the explicitly expected queen-ending promotion coverage failure.
The focused source/React run passes 55 checks with four optional skips. It
checks the single starting lesson and three actual-ply arrows, without importing
the future pin onto the starting board. The generated review service passes
24 checks with one optional engine skip, including saved/reloaded missed
discovery explanations. Type checking, scoped lint, the review build and two
development-worker cache/recovery scenarios pass.

Fresh engine review covers **685 selected searches**: 548 over the new owner
discovery and constructed/reflected variants, 67 over the other changed owner
roots, and 70 over the new course continuation. These overlap in boards and
are not 685 independent puzzles. Whole-position scores are kept separate from
local material bounds. The already-losing Bc3 and approximately equal Rf6+
checks use explicitly contextual thresholds, not a universal positive-score
test. Seventeen separate depth-20 decision searches include the contrary
countercheck answer, old rook-fork exchange and still-unexplained Nxf7 root.

All **2,145 compiled-controller inputs** pass: 808 public cases, all 1,319 owner
contexts, six new discovery controls and twelve existing connected-capture
controls. Each owner result matches both source and the frozen final replay.
All 808 prior public primary ID lists remain unchanged. Public computation and
transfer median/p95/max is **43/204/1,123 ms**; owner values are
**95/412/2,290 ms**. Startup maxima are 36/38 ms respectively. These exclude
engine search, development HTTP loading and native UI. The twenty-second
startup and three-second computation limits are unchanged; these controlled
runs do not resolve earlier load-sensitive startup failures.

The tested worker is `liveTactics.worker-Dy5Sbb7i.js`, 597,227 bytes, SHA-256
`e0ca08fea0e4c0375d881f336f0c7948cf5709fce9a700c0093f802a78633809`.
Source `e8579cb1` is also packaged from a clean committed checkout, with the
same tested worker bytes. Clean source/React/service checks and frontend/native
builds pass. `docs/TACTICAL_DESKTOP_DELIVERY.md` records the exact package,
dependency linkage and previous-executable backup. No owner app was running
or restarted. This establishes package delivery, not native-window interaction
or startup reliability.

## Private receipts and remaining work

Under `Documents/OnCrescent Tactical Benchmarks/`, the `discovery-recapture-`
reports dated `20260917` include `owner149-final`, `private149-final`,
`rare149-final`, `tests149-final`, `probes149-corrected` and
`engine149-corrected`. Additional final engine receipts are
`discovery-additional-engine149` and `discovery-course237-engine149`.
Compiled receipts are `discovery-public-worker149-final` and
`discovery-owner-worker149-final`, with the same date suffix.
The `discovery-owner-fork149-` diagnostic trials and committed-baseline
`discovery-owner-fork148-baseline` preserve the unfinished fork investigation.
Rejected drafts and preliminary chess judgements remain separate.

The Nxf7 quiet-repair fork, comparable-capture causal qualification, other
later ...Nxd4 positions, quiet preparations, the known queen-ending promotion,
broader independent accuracy measurement and native/load-sensitive startup
verification remain open. This milestone does not complete the classifier goal.
