# Checking pawn gains before another pawn capture

Adapter **127 / live pipeline 132** recovers one concrete alternative in the
existing eight-game owner sample. It does not solve broader quiet preparation,
persistent-pawn recall or primary-theme selection.

## Chess judgement and changed result

At ply 28 in the first game of the third sample, **Nxe5+** was rejected because
its nominated follow-up **Qxc7+** captures a pawn, not a minor piece. The two
legal replies are Ke6 and Kg7. After Ke6, Qd5# is strongest; the material
verifier's Qxc8+ also retains its local bound and fresh Stockfish confirms mate
in three. After Kg7, Qxc7+ Qxc7 Nxc7 retains material. These choices have complete
root-defence coverage, rather than relying on just the supplied Kg7 branch.

Nxe5+ now leads its candidate with **Hanging Pawn**, capped at 100 cp of local
gain. The later Trapped Rook stays secondary at ply 9. Starting-board arrows
show only Nxe5+, not the future trap or the queen exchange. Qxc7+ was already a
separately explained alternative and is not counted as a new recovery.

The engine's first choice Bc4+ still needs a quiet queen preparation and remains
unexplained. The principal headline therefore does not change; the result
panel's existing Tactical alternatives path presents the recovered candidate.
The played Nxc7 also captures a pawn: neither the actual best-candidate review
nor a diagnostic Nxe5+-as-best comparison acquires a new missed-material cause.
The latter retains an explicitly comparable capture, not a missed accusation.

Only **one of 420 full owner result rows** changes, through its second candidate.
The other 419 rows and all 246 private-course source/live cases and twenty rare
cases are unchanged apart from versions/timing. This is a replay differential,
not an accuracy rate or proof that their unchanged outputs are correct.

## Why simply lowering the threshold was unsafe

The first draft allowed every pawn follow-up through the stronger countercheck
path. An existing Lichess hGEvH regression then failed: ...Rxg2+ Kf1 Qxh2 was
certified as a retained pawn gain despite abandoning the actual king attack.
Fresh held searches confirm **Rg5 +333 cp** versus **Qxh2 -184 cp** for Black;
Ke2 escapes the immediate mating net. Conversely, after Kh1, Qxh2# is mate.
The latter branch cannot justify the former. This is retained contrary evidence,
not a test expectation relaxed to accept the draft.

The final new-pawn route requires the nominated follow-up capture to have
already been legally profitable before the checking capture. This establishes
the specific opportunity to insert an extra checking pawn gain before another
available capture. Qxh2 was not profitable before ...Rxg2+, whereas the owner
Qxc7+ and constructed Nxa3 opportunities were. Newly created pawn threats in a
king attack still need an attacking proof; this restriction is a coverage
boundary, not evidence that those positions are non-tactical.

Every legal root defence must still have a connected, profitable answer.
New pawn nominations always use the stronger countercheck-aware path, debit
friendly-piece liabilities, and retain the shared **8,192-operation** limit.
The public positive uses 160 visits and the owner example 19, in both colours.
Existing piece-payoff/exchange routes and all runtime deadlines are unchanged.
This is bounded local material evidence, not a whole-game outcome guarantee.

## Independent checks and contrary controls

There are **63 final fresh Stockfish 18 searches**: 56 checking-capture/control
decisions and seven king-attack counterexample decisions. All 56 final request
identities, FENs and held moves match the final verifier's exported branches
and controls. Earlier draft receipts are retained separately, not added to a
count of independent positions.

The public [50-search receipt](pawn-followup-stockfish-18.json) contains only
constructed positions, both colours, every selected answer and countercheck
response. Six owner decisions remain private. The held owner root scores
+733/+730 cp; Kg7 follow-ups score +741/+722; Ke6 answers mate in three. These
whole-position engine estimates are not the certificate's 100-cp local bound.

Controls cover an unsupported knight, a capturable checking queen, an off-square
bishop loss and immediate mating counterplay. The unsupported knight and mating
counterplay follow-ups allow mate in one. The bishop-loss position remains
winning overall: its missing local certificate is not a correct-negative
claim about the whole position. Short/quiet nominations, exhausted budgets,
cache isolation, root-only arrows and compensation-aware review are also checked.

Two audit mistakes were corrected without changing production expectations:
the colour-reflection helper initially left castling rights unreflected, and
the first counterexample engine batch requested an already checkmated board.
The final legal-reflection check and seven-decision batch complete successfully;
the failed/partial receipts remain private. The initial expectation that a
comparable-capture diagnostic should erase stored motifs was also corrected:
its explicit neutral qualification, not an empty array, is the intended contract.

## Verification and delivery

The broad source selection passes **2,448 tests**, with 195 optional skips.
The opted-in owner/proof export passes fourteen focused checks (two skips).
TypeScript, scoped lint, shared-review and frontend builds pass. Twelve actual
React/browser-worker groups check the positive and mating-control cases at
1100/760/360 px and 100/200% text, with keyboard preview and root-only annotations.
All 174 cold-HTTP inputs and ten generated-service/two worker-cache checks pass.
These are isolated browser/controller checks, not native-window interaction.

The production worker passes 25 selected groups, including all ten new
constructed/reflected inputs, plus all **420 owner inputs** in three separate
exact source/compiled-controller replays. All **1,043 prior public primary lists** stay
unchanged when compared by both input identity and analysis lane. Their
computation/transfer median/p95/max is **39/194/1,125 ms**, excluding engine,
startup and native UI. Cold first/max startup is **1,401/1,771 ms** and maximum
computation/transfer is 1,319 ms; server prebuild is separately 3,119 ms.
These passing timings do not erase earlier load-sensitive failures.

Tested immutable worker: `liveTactics.worker-DA5cyGw5.js`, SHA-256
`3c8e9879a527b60d1747002a0642dd622868c77f87882d135657534dc8c7d3f8`.

Private receipts live under `Documents/OnCrescent Tactical Benchmarks/`:
`pawn-followup-{final-engine,verified}-20260916.json`,
`pawn-liquidation-engine-verified-20260916.json`,
`adapter127-tests-verified.json`, `adapter127-{private,rare}-verified.json`,
`chesscom-{recall,disjoint,third}-adapter127-verified.json` and
`adapter127-dev-cold-verified.json`. Paid course and owner boards remain outside Git.

The separately recorded desktop package is documented in
`docs/TACTICAL_DESKTOP_DELIVERY.md`. This milestone does not restart an owner
app, change phone services or mutate saved games/settings. Broader quiet/older
pawn opportunities, Bc4+/Nb5 preparations, representative accuracy measurement
and historical load-sensitive/native-startup reliability remain open.
