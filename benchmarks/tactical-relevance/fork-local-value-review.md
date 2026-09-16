# Local fork values and compensation-aware continuation recall

Adapter **117** / live pipeline **122** follows the second owner-game audit.
It corrects an observed fork-value defect while retaining genuine, substantial
recapture lessons at their actual ply. This is not completion of the broader
recall goal, and removal of an invalid certificate is not a correct-negative
judgement about the whole position.

## Chess findings and changes

The same reached Qa4+ fork previously inherited material from a queen captured
before it or a pawn captured later in the supplied line. The ordinary fork now
uses the minimum supported gain over every legal defence, not the legacy PV
total. Root captures, promotion, defensive promotion and an actual recapture of
a queen which takes the forker are accounted for. Prefix/suffix controls retain
the real fork with its local 320-cp value in both colours.

Fresh contrary evidence invalidated the first numeric-only draft. In an owner
game, the nominated Rxh6+ / Rxc6 fork capture allows ...Re1#. A real Lichess
Nf6+ double check (tA2XR) cannot simply collect the rook either: Nxe4 allows
...Nxb3, losing the queen. Capture leaves now debit immediate off-square
liabilities and reject immediate mating replies under a 4,096-operation budget.
The special exchange-for-pawn fallback and checking-material-attack leaves can
no longer reintroduce the same unsafe gain through a different label. Existing
worker deadlines are unchanged; other called helpers retain their own bounds.

The exchange-for-pawn floor allows the opponent to collect the other minor:
the constructed Nf7 / ...Qxd4 / Nxh8 / ...Qxc4 branch gains 70, not the former
80 cp. The old ...Qxh8 branch really gains 80 but is not the minimum. This does
not lower the general fork or generic-capture threshold. In a separately proved
promotion-clearance combination, its exact all-defence branch certificate
preserves the contextual Ne3+ fork at the correct later ply; a standalone local
exchange cannot borrow that future promotion.

## Recovering useful continuation lessons without inflated gains

When the first move lacks a certificate, a substantial independently checked
Winning Recapture can now remain in the bounded, conditional timeline. It does
not supply a root mistake cause or starting-board future arrows. Routine pawn
exchanges and unrelated late captures remain filtered.

This recovers two actual queen-for-minor captures in the second owner sample
and a capture in the first sample's saving-perpetual continuation, viewed from
multiple earlier contexts. These are three capture events, not six independent
recoveries. The already detected reached-board primary themes remain.

Reviewing every new course recapture exposed a further defect: same-square SEE
ignored immediate compensation elsewhere. The shared recapture helper now
uses the liability/countercheck-aware capture bound before subtracting the
preceding trade. Two proposed course badges are consequently withheld: one
queen-for-bishop sequence immediately loses a rook and is approximately equal
in fresh engine analysis; another rook-for-pawn sequence concedes a knight.
The genuine public opening Qxd5+ recapture remains, but ...Kxf6 reduces its
bound from 570 to 470 cp. Real puzzle R13Ct retains ...Kxf7, now 210 rather than
220 cp because Nxd6+ / ...Qxd6 exchanges the other minor pieces.

## Contrary tests and still-missing explanations

- tA2XR remains winning in fresh held searches: Nf6+ is +244 cp; after ...Kh8,
  the tempting Nxe4 is -661 while the quiet Qf7 is +194. The quiet repair of
  the queen liability still lacks a root certificate. Its new empty result
  is a coverage failure, not a non-tactical position.
- A course checking fork likewise needs a quiet rook-saving tempo which
  attacks the queen before collecting the other target. Fresh held root,
  premature capture, countercapture and repair searches are recorded privately.
  The root is +178 cp and the repair +186; the premature bishop capture even
  allows mate in three, not merely the initially noticed rook loss. That causal
  root explanation is still missing.
- An older opening Forcing Attack proof used a queen exchange which then
  lost the f6 pawn, eliminating its claimed gain. The different, conditional
  queen-for-bishop recapture remains useful; it cannot prove the opening attack.
- An old constructed 'unsound offer' wins a pawn ending for the defender, but
  returns the captured queen and is not a 570-cp windfall. The test now checks
  the actual exchange and separately retains a genuine unprotected recapture.
- Capturing a checker refutes one supplied mate, not every mate. Fresh engine
  review found a different longer mate after the old rook-acceptance control;
  that capture no longer claims a four-pawn win.
- The old 'wrong history' control changed only the captured victim and still
  reached an identical board. It now changes a surviving piece and genuinely
  tests rejection of mismatched history, without assuming unknowable history.

The fixed replays change 31 of 246 private full results and three of twenty rare
results. Only the above course root and tA2XR lose primary IDs. Across the owner
samples, fifteen of 217 and twenty-four of 122 full rows change, including text,
values, source-game lines and mistake explanations. All first-sample primary IDs
remain; the second sample loses the unsafe Rxh6+ fork. Repeated contexts and
wording changes are not additional recovered tactics or accuracy measurements.

## Verification and receipts

Seventy-one final fresh depth-16 searches comprise 48 fork/value probes, nine
course/constructed compensation probes, ten public recapture controls and four
course quiet-repair probes. Some revisit identical boards; this is not 71
independent positions. Full-position engine scores are distinct from local
material bounds. Earlier draft reports and rejected witnesses remain recorded.

The selected source suite passes 2,357 tests across 151 files, with 163 optional
skips at that run. TypeScript, scoped lint and frontend/shared-service builds
pass. Twenty-four real React/Chrome groups cover the corrected fork and retained
quiet-fork flow at three widths and 100/200% text; the narrow enlarged rendering
was inspected. Ten built-service checks include actual Stockfish, and both
development-cache/error-recovery tests pass.

Sixteen enabled production-controller groups pass, including 217 exact owner
scan matches and twenty new reflected fork/recapture controls. A separate group
matches all 122 second-sample scans. All 1,043 prior public input IDs remain;
three primary lists change: the unsupported opening Forcing Attack gives way
to an explicitly later trap, and both colours of an existing queen-liability
control lose their unsafe fork while retaining the later pin. Public worker
computation/transfer median/p95/max is 38/187/851 ms, excluding engine/UI.
The tested artifact is `liveTactics.worker-CRchPKBW.js`.

Private receipts are in `Documents/OnCrescent Tactical Benchmarks/`:
`adapter117-tests-complete.json`, `adapter117-{private,rare}-recapture.json`,
`chesscom-{recall,disjoint}-adapter117-recapture.json`,
`fork-local-value-engine-release-20260916.json`,
`fork-local-value-compensation-engine-20260916.json`,
`recapture-controls-engine-20260916.json`, and
`fork-repair-coverage-engine-20260916.json`. Paid and owner-game details remain
outside Git. Source and engine inputs are frozen; replay makes no new searches.

Both an earlier draft and the final forced-cold development attempt timed out
at 20 seconds while the HTTP worker module had not completed loading. In each
failed run the child test exited and the isolated server runner then hung in
shutdown with no remaining TCP connections; only that verified test process
was stopped. The final warm-cache HTTP run passes all 113 cases, but does not
erase either failure or certify native startup. Its first/max startup is
1,010/4,009 ms. No owner app, phone
runtime, games or settings have been changed by these verification runs.
Desktop delivery is recorded separately in `docs/TACTICAL_DESKTOP_DELIVERY.md`.
