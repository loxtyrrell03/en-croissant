# Board shortcut ownership

Recent Novelty commits39015b80 anddaed08c0 preserve arrow-key ownership for menu
triggers and resize controls. En Croissant's native BoardAnalysis had a broader
version of the same defect: its window capture listener always cancelled Left
and Right before the focused control could receive either key.

The production effect now installs bindBoardMoveShortcuts. The binder yields to
text inputs/editors, selectors, menus and menu triggers, resize separators,
sliders/spin controls, tabs, trees, grids, toolbars and radio controls. Open
modals retain focus ownership while their focus trap is settling. Hidden/inert
retained dialogs do not block ordinary board navigation. Composition, modifier
keys and already handled events retain their existing owner. SVG descendants,
shadow-root controls and window-targeted events follow the correct control.
Ordinary board/buttons still navigate both directions; replacing callbacks or
unmounting removes the previous capture listener.

The callback was first extracted unchanged from BoardAnalysis. With actual DOM
events and its capture listener,26 of33 cases fail on that old behavior. The
fixed37 cases include a control handling its own navigation, composition,
SVG/shadow input, focus fallback, retained dialogs and mounted effect cleanup.
Full TypeScript and three-file lint pass without warnings/errors. No owner data
or live UI interaction was used. The phone has no matching global Left/Right
listener, so its existing touch and native-control navigation is unchanged.

This is source/DOM-event evidence, not rendered or native-window interaction.
The prior verified native package193ae3e6 predates the fix; a fresh native
package remains required. Hosted phone f1dab735 remains verified independently.
The broader history audit is still active.
