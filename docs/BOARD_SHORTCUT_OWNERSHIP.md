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
Native package0987379c now contains the exact BoardAnalysis ownership asset
alongside13 other verified assets, Windows IPC, complete notices and102 engine
resources. The48,925,696-byte executable has SHA256
`4d5126dcc4131965c44722a601afc42469e5a325e9ce2f2885cbd4a682c7ee74`.
Build126 seconds/22 existing warnings, frontend27.50 seconds. Both checkouts
pass37 focused checks and full types; clean scoped lint is warning-free.
Generated source matches and the previous verified package remains rollback.
No native app was launched or manually restarted. Hosted phone f1dab735 remains verified independently.
The broader history audit is still active.
