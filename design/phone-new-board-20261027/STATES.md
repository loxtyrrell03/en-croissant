# Phone board controls refinement

This scoped correction retains the previously selected compact phone layout,
theme, move-navigation strip and board panels. `controls.svg` is editable;
all illustrated names and games are invented. The rendered app is authoritative.

| Surface/state | Behaviour |
| --- | --- |
| Blank board, loaded game or Prep | Header New opens the same three choices. |
| New board | Save current work, open an independent starting board in Moves. |
| New position | Bottom sheet accepts legal FEN or captures the current position. |
| Invalid FEN | Visible error; preserve draft and current board; allow correction. |
| New file | Bottom sheet requests a name; collisions receive a numeric suffix. |
| Save pending | Disable repeated creation; retain the old board until storage finishes. |
| Save failure | Keep old board and draft, show error with Try again or Cancel. |
| Board changed during save | Cancel the switch; never overwrite newer work. |
| Cancel/Escape/outside tap | Dismiss the idle sheet without creating a file. |
| Navigation during a pending request | Do not force the user back from another screen. |
| Saved boards in Files | Open existing boards; archive uses existing reversible behaviour. |
| PGN export | Preserve game tree and use the chosen file name. |
| Board menu | Flip board and Return to main line; preserve variations. |
| Under the board | Existing move navigation and tools; no reset-button row. |
| Help | Existing focus/touch/dismissible help beside the position label. |
| Narrow widths | Viewport-bounded menu and bottom sheet;44px primary touch controls. |

Source evidence:50 focused tests across eight files and whole-project types pass;
new/changed small components have zero lint diagnostics. WebApp retains25 baseline
warnings. Isolated Chrome checks cover320/390px, creation, collision names, FEN
validation, current position and cancellation. No physical-phone proof is implied.
Delivery is recorded separately from this source milestone.
