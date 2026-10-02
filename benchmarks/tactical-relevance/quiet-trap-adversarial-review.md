# Quiet-clearance and trap adversarial audit

The concrete correction is a **trap draw boundary**, not a broader tactical admission. `proveTrappedMaterial` now rejects an already ended position, an automatic 75-move ending before the root move, and a defender's current or legally announced 50-move claim after the root. It reuses the existing draw-rights helper. No geometry, material threshold, search allowance, clearance detector or trap-confinement rule was loosened.

## Fresh evidence and defect

Six source-game-disjoint development nominations were selected before inspecting classifier output. Exact fixture identity, prior-review exclusions, seed and cases are in `quiet-trap-adversarial-selection.json`; pre-output hypotheses are in `quiet-trap-adversarial-hypotheses.json`. Source puzzle themes nominate inspection, not correct answers. No holdout, owner store, full corpus or engine was used.

Public **FSJC4** provides a genuine Ra3 queen trap, proved over all 33 replies in each colour. Its source clock is zero. Explicitly constructed clock variants exposed the defect: the old helper and public classifier still reported high-confidence primary Trapped Queen/170 at root clocks98,99,149 and150. At98, White can announce the legal quiet Rb1 to reach100; at99 a current claim is already available after Ra3; at149 the quiet root move reaches the automatic150 threshold; at150 the game has already ended. The reflected cases exchange the claimant colours.

The new gate removes that primary and its borrowed later Winning Recapture from the **complete root and full-line output**, leaving both motif and timeline arrays empty. This is abstention, not a positional diagnosis. Normal clock0 and97 still return the trap; at97 the later claim belongs to the attacking player, who may instead capture and reset the clock. Adding a pawn on a3 makes the root an actual capture: it resets99/149 and retains a270 local bound, but cannot revive a game already ended at150. A separate pawn-initiated bishop trap resets99/149 and retains230. Immediate checkmate still takes precedence when its move reaches150.

The production edit is only the entry condition of `proveTrappedMaterial`. Its direct and alternate target-collection endpoints are captures and reset the clock; existing defender-removal and pin continuations keep their existing terminal/material proof safeguards. This does not certify unknown repetition histories throughout hidden material branches.

## Other fresh observations

`q4FtX` correctly refuses to call Qxh6 a newly created trap: Ra1 already has no legal flights because its own pawn and knight block it. Its separate root Material Gain230 remains. `2qDuS` opens Re1-e8 but Ng5 does not attack a new enemy major piece, so the narrow knight-clearance proof correctly abstains. The castling root in `3LtAI` and quiet rook root in `9YfbQ` likewise cannot borrow that knight-specific mechanism. `gMkbY`, `2qDuS`, `3LtAI` and `9YfbQ` currently have empty classifications; their broader source tactical stories remain unadjudicated, not established false negatives or positional play.

No additional false-positive checking-capture liability example was confirmed. The audit does not claim to rule out longer quiet counterplay. Known older Xg7Rd/wN37d cases were excluded from this fresh selection; their existing regressions were rerun as controls.

## Verification and replay

- Identical initial18 contracts: **8 passed/10 failed before**, then **18 passed/0 failed after**. The receipt preserves that assertion-file hash; the final file adds14 contracts and separately passes32/32.
- Six focused suites: **170/170** (32 new draw-boundary,16 fresh mechanism checks,16 confinement,24 quiet-clearance,54 existing tactical draw,28 existing material-claim).
- `trap-draw-boundary-verify.py`: **26 independent python-chess witnesses** for both claimants, legal announced moves, resetting captures/pawns, automatic endings and checkmate precedence.
- Whole-project and scoped benchmark types pass; scoped lint reports zero errors/warnings. `quiet-trap-adversarial.test.ts` optionally emits a create-only report through `QUIET_TRAP_ADVERSARIAL_REPORT`; the retained Vitest config reruns the fresh observations. The standard source suite reruns `src/utils/tests/trapDrawBoundary.test.ts`.

`quiet-trap-adversarial-verification.json` contains exact checkpoints and results. Its whole-core hash includes concurrently integrated quiet-intermediate work **and the user's pending checking-ray changes**; it is not an exclusive patch or staged-core hash. Parent integration owns the final exact-index tests/build/version/commit. This agent did not stage, commit, change runtime, scan owner data or modify the separate website.
