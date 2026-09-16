# Explain the revealed pin through its initiating discovery

Adapter **133 / live pipeline 139** improves the specific primary explanation
of an already detected combination. It does not claim new root recall.

## Owner-game judgement

The reviewed **Ng5** opens the bishop's attack on a queen pinned to its king.
Previously, a long supplied line led with **Quiet Preparation**, followed by
Pin and Discovered Attack. A root-only line could instead put Pin first. Both
mechanisms were independently established, but the generic headline obscured
what the knight move actually did.

The discovery now leads; its absolute pin remains supporting evidence. A
generic preparation is removed only when an independently proved discovery
opens an attack on that preparation's actual victim and covers at least its
material bound. A pin is demoted only when every relevant pin ray is part of
that same newly opened discovery. Existing/unrelated pins, greater preparation
gains and mating mechanisms are not globally reordered. No proof budgets,
engine thresholds or deadlines change, and no label is admitted from geometry
alone. Board labels, root arrows and actual-ply timelines share the result.

The owner actually played Ng5. This is not a newly missed tactic. The separate
Nxc7 fork remains the preferred live tactical option in the existing targeted
candidate scan. Before adding automatic targeted Mistake Review acquisition,
note that its collector and adapter currently accept only three candidates;
the two reviewed extra live options cannot simply be called missed mistakes.
Ng5 was played, and the alternate fork has only a small full-position edge
over that move. The other reviewed pawn option's independently searched score
exceeds the old main-search score, so its comparison needs consistent evidence.
Automatic acquisition remains a separate unresolved task, not part of this fix.

## Independent checks and contrary evidence

There are **41 fresh Stockfish 18 depth-16 searches**: unrestricted/held roots
and all 25 legal replies to the owner move; unrestricted/held roots and all ten
replies in a stripped-down constructed battery; and two contrary controls.
The owner root's main move is +139 cp, held Ng5 is +74, and all reply-position
searches remain positive for White (the smallest is +71). These independent
finite searches support the reviewed choice; they are not an exact global
minimax certificate or the classifier's local 250-cp material bound.

The constructed battery is deliberately **not a second sound game tactic**.
It wins a queen for two minors locally, but removing the other material makes
the resulting pawn ending lost: Ng5 is -506 cp while Nf4 is +412. A regression
therefore checks both the local mechanism and rejection of Ng5 as an inferior
live alternative. Removing the bishop's pawn guard allows Qxc4+; moving the
king off the ray allows the queen to escape. Both controls reject the claimed
high-confidence mechanism in both colours. Do not confuse positive local
material with a good move or a winning position.

## Verification and limits

- The broad source selection passes **2,545 checks** with 205 optional skips
  across 172 files. A final focused renderer/source selection passes 50 checks
  with three optional skips; these counts overlap.
- All **512 owner contexts** replay exactly. Two rows change: Ng5's source
  explanation and a preceding line's actual-ply continuation. No principal
  live theme or mistake classification changes in that original input set.
- The separate **92 targeted-candidate inputs** are replayed against adapter
  132 in its clean checkout. Only the same two positions change; the live Ng5
  option now has the specific headline. Comparing directly with pipeline 137
  would additionally include the already shipped checking-pawn fix, so that
  older comparison is not attributed to this milestone.
- All **246 private course** and **twenty rare-theme** full source/live results
  remain unchanged against the prior frozen receipts, ignoring versions.
  Unchanged is not certified accurate.
- TypeScript, seven-file lint, the generated 43-module review build, eleven
  generated-service checks (one optional engine skip) and the main-worktree
  frontend build pass. The latter contains unrelated changes and is not the
  native delivery input.
- The actual compiled production controller passes **610 inputs**: 512 owner
  contexts, 92 targeted-candidate contexts and six constructed/reflected
  mechanism controls. This is source/worker parity, not independent chess
  accuracy or native-window verification. Worker artifact:
  `liveTactics.worker-C8z0Tbnr.js`; private owner receipt:
  `discovered-pin-worker-20260916.json`.
  Owner computation/transfer median/p95/max is **89/314/1,287 ms**, with a
  maximum Node-bridge startup of 35 ms. These exclude engine search, HTTP
  loading and native UI, and do not settle historical cold-start failures.

The first broad runner mistakenly forced the Node environment on DOM tests:
112 checks failed with missing window/document, not chess assertions. The final
run restores the configured environment and passes; the failed receipt remains.
Private receipts are `discovered-pin-{probes,engine,owner,targeted,private,rare}-20260916.json`,
`discovered-pin-targeted-baseline132-20260916.json` and
`adapter133-tests-final-20260916.json` under the owner's private benchmark folder.
No paid course or owner-game board is published.

This is a primary-explanation improvement on reused development evidence, not
a recall/accuracy percentage. Longer quiet preparations, automatic review
candidate acquisition, broader primary judgement and native startup reliability
remain open. Desktop packaging is recorded separately in
`docs/TACTICAL_DESKTOP_DELIVERY.md`; no owner app or phone service is restarted.
