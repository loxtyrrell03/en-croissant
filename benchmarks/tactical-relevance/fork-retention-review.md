# Fork retention without an invented extra gain

Adapter **150 / live pipeline 157** restores the owner-game Nxf7 fork lost in
adapter 149. This is an accounting correction, not a lower threshold for
generic tactical claims: the complete fork still needs a gain of at least
100 cp against every legal defence within the original 4,096-operation budget.

## Chess judgement and corrected hypothesis

Nxf7 takes a pawn and forks two rooks. The important reply ...Nc4 attacks the
queen, so a simple two-target geometric check is insufficient. After Nxd8,
...Nxa3, Nxb7, ...Nc2+, Ke2, ...Nxa1, Rxa1 and ...Kxb7, the queen/rook/minor
exchanges break even: the original f7 pawn remains the net material gain.
The king's departure from e1 lets the h1 rook recapture on a1. Independent
piece counting in both colours checks that the whole line gains exactly
100 cp; it does not win a rook outright.

The earlier quiet-queen-repair hypothesis was incomplete. Qa4 meets ...b5 and
Qb4 meets ...a5, but the existing connected collection already has a sound
capturing answer. Its inner exchange needed to be allowed to retain zero,
because the original fork capture supplies the outer 100-cp gain. Adapter 149
incorrectly demanded another positive gain from that inner exchange. No
new quiet-escape or trapped-knight rule is shipped here.

The zero bound is accepted only for a capturing entry with all friendly-piece
liabilities and counterchecks enabled. Quiet entries, negative bounds,
disabled safety checks and exhausted budgets still fail. Other production
callers retain their positive minimums. Removing the initial pawn or the
recapturing rook withholds this certificate; that is not a claim that every
such changed whole position is losing.

Fresh depth-20 decision searches support Nxf7 and its compensation. The
constructed no-f7-pawn control remains winning (+401 cp) despite withholding
this certificate. Whether it has another useful tactical proof remains open:
a positive whole-position score proves neither a missed tactic nor a correct
negative classification. Removing the recapturing rook instead yields -179 cp
for the held Nxf7 in that constructed position. Full engine estimates are
not the local gain guaranteed by the bounded verifier.

## User-visible explanations

The owner root again leads with **Fork**, not merely Hanging Pawn. The previous
queen move gains an allowed-fork explanation: Qe8 would let Qxf7 take the
forking knight. Fresh searches find that attempted Nxf7 losing after Qe8;
Black is already worse before choosing between Qe8 and Qb7, so this local
prevention is not a claim that Qe8 saves the entire game. The owner actually
played Nxf7 and receives no missed-fork accusation.

Constructed missed choices use the same fork and 100-cp value through the
generated review service, saved cards and reload. Their mocked scores test
wiring only; separate Stockfish searches compare Nxf7 (+395 cp) and Rc1
(+252 cp) in the constructed position.

Fork wording now distinguishes a defended exchange from an outright free
target whenever the proved gain is less than the original capture plus the
smallest forked non-king victim. Root labels, values and current-ply arrows
are retained. A secondary Nc2+ fork no longer says it wins a free rook when
the knight can be recaptured. Exact connected countercapture roles remain
at their actual plies rather than adding their totals to the root gain.

## Same-input comparisons

The 27-game, 1,319-context owner replay changes seventy full rows, ignoring
version/timing: three around Nxf7 change classifications, while the other
67 change only explanation wording. Only one live primary ID list changes.
The earlier Ne5 source continuation gains the later fork without turning it
into an immediate live headline. Of 246 private course/generated-game rows,
fifteen change only fork wording; their motif IDs and values remain unchanged.
All twenty rare-theme full results remain unchanged. These are development
and regression comparisons, not seventy recovered tactics or an accuracy rate.

## Verification and delivery

The selected source suite passes **2,742 tests**, with 316 conditional skips,
including the explicitly expected queen-ending promotion coverage failure.
The focused source/React run passes 63 checks with five optional skips.
The generated review service passes 25 checks with one optional engine skip.
Type checking, scoped lint, review/frontend builds and two development-worker
cache/recovery scenarios pass.

The final fork certificate's **391 selected decision searches** all complete
at depth 16, with positive whole-position scores (minimum +222 cp). They cover
the real root and constructed/reflected variants, not 391 independent puzzles.
Nine separate depth-20 comparisons include the allowed-fork defence and the
contrary winning no-pawn control. A separate 49-search diagnostic receipt
examines the older certificate; it is not included in the final 391.

All **2,151 compiled-controller inputs** pass: 808 public cases, all 1,319 owner
contexts, six new fork controls and eighteen retained discovery/capture controls.
All 808 prior public primary ID lists are unchanged. Owner results match both
source and the exact final replay. Computation/transfer median/p95/max is
44/210/1,126 ms for public inputs and 95/422/2,181 ms for owner inputs;
startup maxima are 36/38 ms respectively. These exclude engine search,
development HTTP loading and native UI.
The worker is `liveTactics.worker-Cg-XvgHJ.js`, 597,454 bytes, SHA-256
`971ca931ea9016acc9fbfb910bba6da5dcfe275cbfa7c8262d2b88e28ddca5ef`.
The twenty-second startup and three-second computation limits are unchanged;
controlled worker runs do not resolve native/load-sensitive startup failures.
Clean desktop delivery follows separately.

## Receipts and remaining work

Private reports under `Documents/OnCrescent Tactical Benchmarks/` use the
`fork-retention-` prefix and `20260917` suffix: `owner150-final`,
`private150-final`, `rare150-final`, `comparison150`, `tests150-final2`,
`probes150-draft`, `engine150-draft`, `decisions150` and
`decision-engine150`. The draft-named certificate/search files describe the
final unchanged chess proof; only explanation wording and test coverage changed
after their run. Compiled receipts are `fork-public-worker150-final` and
`fork-owner-worker150-final`, with the same date suffix. Preliminary reports
remain separate. Paid and owner inputs
are not committed.

Longer/quiet fork repairs, adjudication of the winning no-pawn control, comparable-capture
mistake causes, other quiet preparations, the known queen-ending promotion,
longer and source-only truncated countercapture context, independent accuracy measurement
and native/load-sensitive reliability remain open. This milestone does not
complete the classifier goal or broaden runtime deadlines.
