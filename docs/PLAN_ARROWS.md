# Plan arrow ownership and priority

Native Plans and Engine Plans now claim arrow priority whenever their mounted
Auto arrows control is on, including empty, loading and error states. Engine
arrows return when the last claim releases. The saved engine-arrow preference
is retained; its disabled controls use adjacent keyboard/touch help to explain
how to restore them.

Ownership follows the actual tree store, rather than whichever tab happens to
be active when cleanup runs. Each control releases only its own claim. Hover
setters have a board/position lifetime, and old setters or cleanup cannot
replace or clear another owner's preview. The former active-tab preview atom
was transient and is removed; no saved-data migration is needed.

Automatic routes and hover previews are independent layers. Both are filtered
against the displayed FEN. Hover does not remove automatic routes or saved plan
drawings. Identical plan shapes are deduplicated, including routes already
saved on the node, while different colours/styles remain distinct. Saved
annotations and review hiding continue through the existing drawing path.

The approved phone Analysis layout now includes Auto arrows and Max arrows in
Plans. Defaults are on and ten arrows, with an explicit limit from one to 32;
existing depth/horizon preferences remain compatible. Automatic routes follow
the displayed side and horizon. Hover/focus previews and tapped plan details
supplement those routes. Closing details restores the automatic layer. All
plan shapes use the existing native palette alongside Chessground's base
brushes and stay outside saved phone annotations.

Phone panels remain mounted while hidden, so only the visible Plans surface
claims priority. Hiding it or switching workspace releases its overlays and
restores live arrows without changing the live engine's settings. Workspace
identity prevents a same-FEN report or late reply from crossing games. Arrow
limit changes publish reactively and require neither another engine search nor
a successful browser-preference write.

Three composition failures were reproduced from the former native algorithm:
priority ignored empty plan controls, hover replaced automatic routes, and
hover lacked a position guard. The port passes 65 checks across seven files,
including actual React ownership/phone controls, existing extraction/drawing
tests and real Chessground SVG rendering with both user and plan marks. Full
types and twelve-file lint pass without warnings/errors. WebApp's separate 25
warnings match its HEAD baseline exactly, with no errors.

This is source/component/SVG evidence. Clean builds, package delivery and
rendered narrow/touch verification are separate. Browser control remains
disabled in Work settings; synthetic SVG checks do not prove layout at 320 or
390 pixels or physical-phone behaviour. No service, route, native engine
protocol, owner profile or database was changed by this source slice.
