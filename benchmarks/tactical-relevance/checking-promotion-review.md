# Promotion threats through checking defences

Adapter **159 / live pipeline 166** integrates the real-game route investigated
in `checking-promotion-recall-audit.md`. The owner's ...h2 now receives an
immediate Promotion Threat headline even though Ra6+ delays queening. This is
one recovered tactic, not completion of broader tactical recall.

## Chess and proof boundaries

Immediate promotion certificates are retained first. If a checking reply blocks
that proof, a second pass can answer at most two checking defences. Both passes,
all alternatives and all promotion leaves share the existing 32,768-operation
allowance. Legal captures, interpositions and king evasions are included; no
checking move is treated as a pass. The original pawn must ultimately promote.
Earlier captures cannot finance an unsound promotion, and defensive captures,
counterpromotions and the existing leaf counterplay checks remain included.

The actual ...h2 tree selects ...d6 against Ra6+, then ...Nxd6 against Rxd6+.
All twenty root replies and 35 subsequent replies are covered. The minimum
local material bound is 380 cp; the production proof charges 3,639 operations,
including the preliminary immediate attempt. Its colour-reflected counterpart
has the same bound and charges 3,633 operations. The reflection is a control,
not another real-game discovery. No whole-game win or mate distance is inferred
from this local bound.

Constructed/reflected controls retain the guarded promotion, reject a pawn
which can be captured, and reject exchanges of an unguarded promoted piece.
Fresh engine review supports 224 final decisions: all selected positive tree
answers, root alternatives, a missed promotion after giving away its supporting
rook, and a defence which captures the pawn before it advances. Giving away
the rook draws in those fresh searches rather than losing the whole game;
the primary rook-loss lesson is local, with the missed winning promotion
secondary. Controlled service-test scores are not those engine estimates.

An independent python-chess checker verifies four production trees and all
196 reply edges, checking root/internal completeness, legal evasions, actual
promotion of the original pawn and entry material balance. Missing root or
internal replies fail. It does not independently establish the existing
promotion-leaf retention arithmetic or solve the entire ending.

## Display and mistake explanations

The root wording acknowledges checking defences rather than promising promotion
on the next move. The starting board shows only the pawn advance and its actual
promotion route, not future king moves or captures. A matching certified line
can extend the timeline to ply seven, where Promotion Payoff has no duplicate
material value. A different engine continuation cannot borrow that certificate.
Existing initiating forks retain priority over promotions which merely collect
their targets.

Capturing the pawn can establish prevention; a checking move or failed alternate
proof alone cannot. Same-best and equivalent retained opportunities are not
called missed. In the real game the owner played ...h2: no missed card is invented.
The preceding move receives neutral tactical context because its comparison
against Ra6+ is not yet established. Constructed missed lessons survive the
generated shared-review service and saved reload in both colours, remaining
secondary to the supporting rook's larger loss.

## Verification and changes

- The same 27 games / 1,319 contexts change in exactly two full rows: the
  recovered root and preceding tactical-context explanation. The other 1,317
  full rows remain unchanged apart from versions/timing. One tactic is not two.
- All 246 prior private-course/generated-position full results and twenty
  rare-theme full results remain unchanged. This is stability, not accuracy.
- 2,903 selected source tests pass, with 349 conditional skips. Focused source/
  React tests, TypeScript and ten-file scoped lint pass. Thirty-four generated
  service checks and two development-cache/recovery checks pass (one optional
  engine test skipped). The first service fixture used an unfinished game,
  which was correctly ignored; it was corrected to a completed synthetic game.
  The cache test requires Node's experimental VM-modules flag; its initial
  invocation omitted that flag and was rerun correctly.
- All 2,153 compiled-controller inputs pass: 808 public, 1,319 owner contexts,
  twenty existing promotion controls and six new checked-promotion controls.
  All 808 prior public primary lists remain unchanged. Public computation/
  transfer median/p95/max is 44/207/1,124 ms; owner figures are 95/409/2,074 ms.
  Maximum startup is 36/38 ms respectively. These Node-host figures exclude
  engine and native UI and are not a controlled speed-improvement claim.
- Review and main-checkout frontend builds pass. The latter includes unrelated
  dirty work and is not the delivery source. Tested worker:
  `liveTactics.worker-CR1SSDqJ.js`.

Source `9b1b2e50` is now packaged from a clean committed checkout. Its worker
matches the tested bytes, and exact native asset/dependency linkage identifies
the classifier and review surfaces. Clean types, 145 focused source/React
checks (four conditional skips), 34 service checks and review/frontend/native
builds pass. The prior executable is backed up. The existing debug Dev App
session was preserved, with no app restart or shortcut change. See
`docs/TACTICAL_DESKTOP_DELIVERY.md` for hashes, recovery and delivery scope;
this is not native-window interaction or latency proof.

Authoritative private receipts use `checking-promotion159-` under
`Documents/OnCrescent Tactical Benchmarks/`, dated `20260917`: `trees`, `engine`,
`owner`, `private`, `rare`, `tests`, `public-worker` and `owner-worker`.
Paid material and owner positions remain outside Git.

Longer checking/quiet preparations, unproved alternative continuation linkage,
the preceding real move's causal comparison, broader capture recall/primary
selection and native/load-sensitive startup remain open. Owner stores are not
automatically rescanned, and no app session or phone service is restarted.
