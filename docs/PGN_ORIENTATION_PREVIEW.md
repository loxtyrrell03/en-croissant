# Imported perspective and PGN previews

This ports Novelty's `e4233ec2` perspective fix through En Croissant's native
parser/preview/tab architecture and phone game-opening path.

`utils/pgnOrientation.ts` normalizes an explicit White/Black header, including
whitespace and case. Otherwise a standalone position faces its starting mover;
ordinary games keep the existing fallback. Navigation uses the original start,
so advancing to the other colour's turn never flips the board. Native tab
metadata without an orientation no longer erases the imported perspective;
explicit caller choices still win.

The phone reads portable headers when opening existing games. An unplayed FEN
now retains its actual starting board instead of falling back to the standard
position. Explicit Prep/player perspectives override imported defaults. This
requires no migration or rewrite of saved games.

Native Files/Database previews show the selected node's saved arrows and circles
in the same Chessground orientation as the pieces. Their full notation renderer
always shows starting/move notes, NAGs and variations, independently of editing
view preferences. Move selection and navigation remain available; annotation,
promotion and deletion menus are disabled. Preview navigation does not register
global board shortcuts or clear another board's shared replay clock.

Boards fit short panes and stack above notation in narrow panes. Narrow replay
controls retain accessible names/tooltips and use the existing icon language.
Notation scrolls while the navigation row stays visible. Imported and older
saved same-square marks export as PGN circles rather than zero-length arrows.

The shared Chessground wrapper always supplies its base brushes, merges the
selected style/caller overrides, and rebuilds SVGs when the brush palette
changes. An explicit `undefined` palette previously erased native defaults;
real rendered saved marks exposed the crash. Palette changes also need a redraw
because the upstream SVG cache keys shapes rather than brush values.

Verification uses tiny synthetic games. Parser/tab/phone helpers, actual phone
PGN import controls, read-only notation in both layouts, isolated navigation,
real Chessground drawing/style changes and circle preservation have regression
coverage. Chrome fixtures verify full rotated boards, arrows/circles, side-line
navigation, explicit/standalone perspectives and bounded layouts at 900/390/320px.
This is source/component proof until a matching clean runtime delivery is
recorded; native-window and physical-phone interaction are separate.
