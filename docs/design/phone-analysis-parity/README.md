# Phone analysis parity options

These editable SVGs propose the missing whole-game report and Engine Plans
surfaces. They use the existing phone app's dark Mantine palette, blue actions,
five board tools and green board. All games, numbers and plans are invented
examples. They are design artifacts, not implemented or deployed screens.

| Option | Navigation and tradeoff | Editable state map |
| --- | --- | --- |
| A — Board Analysis | Rename the existing Engine tool to Analysis, then use Live / Game report / Plans within it. Keeps the board close to every action and the existing five-tool width. Recommended for the current board-first app. | [Board Analysis](a-board-analysis.svg) |
| B — Task sheets | Keep Engine and its settings. Analyze game / Explore plans open bounded, dismissible bottom sheets. Preserves current navigation, with less board visible while inspecting details. | [Task sheets](b-task-sheets.svg) |
| C — Analysis workspace | Open a dedicated Analysis workspace with a small board, report and plan details. More room for results, with an explicit Open on board action for full-size navigation. | [Analysis workspace](c-analysis-workspace.svg) |

[Side-by-side main views](overview.svg) complement the twelve-state map in
each full SVG. Every design covers setup/empty, limits/settings, running/progress,
plan results, exact plan detail, touch/focus help, engine startup, error/retry,
cancellation, changed-game ownership, 320px stacking and storage failure/retry.

The shared behavior is independent of placement:

- Whole-game reports use Low/Medium/High/custom depth and time bounds, with
  actual completed limits/depth/engine retained beside results. Game accuracy
  remains distinct from the phone's calibrated Strength estimates.
- Plans default to depth 17 for fresh settings. Horizon filtering uses cached
  occurrences. Exact supporting PVs, actual ranks, origins/preparation and
  conditional White-perspective scores stay attached to details. A conditional
  continuation score cannot become an independent setup or strength score.
- Live engine controls retain their own preferences. A report uses one owned
  job; switching game cancels obsolete work. Closing a task view must not apply
  late scores to a different board.
- Completion replaces an earlier report only after a successful durable save.
  Failure/cancellation leaves the previous report and retry action available.
  There is no extra destructive confirmation for starting a reversible analysis.
- Adjacent help opens on hover, focus or touch, stays within the viewport and
  can be dismissed. Errors and unsaved-result consequences stay visible.
- Every layout must be checked at 320/390px, large text and keyboard-sized
  viewports, in loading/empty/error/completed states, with real action wiring.

The owner selected **A - Analysis beneath the board** on 24 October 2026.
The Live / Game report / Plans source implementation now follows this direction.
See [Phone Board Analysis](../../PHONE_ANALYSIS.md) for behavior, verification
and the remaining browser/runtime delivery boundary. No further layout approval
is required.
