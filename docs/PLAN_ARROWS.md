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

Clean source `1f597195` independently passes 619 related checks across 77
files and full types. The complete native build passes with 22 existing
warnings. Its 47,864,320-byte EXE has SHA-256
`676a8be5514092221ed7c63aab8ffeec63b0cb4a7aeead711dd3dfd2cb1a439b`.
Nine affected native/phone engine/board chunks match their exact decompressed
Tauri assets, and their compressed bytes are embedded in that executable.
All 102 bundled engine/source files still match the verified 104,581,828-byte
tree; all eighteen owned committed files apart from root notes match primary.

The canonical phone build passes in 22.67 seconds. Its WebApp chunk is
`WebApp-Bi_25Gyt.js`, SHA-256
`beeef1940e809eba7e4d9436d69d33ba37a41df8445398654740bff1bf3938eb`.
Shared plan code and pinned Stockfish 19 lite JS/WASM have separate hashes in
the delivery JSON. Only two known generated build outputs were restored, and
the delivery checkout is clean. This phone build has not been published; the
live phone still identifies source `89f64228`.

This is source/component/SVG and package evidence. Browser control remains
disabled in Work settings; synthetic SVG checks do not prove layout at 320 or
390 pixels or physical-phone behaviour. Rendered verification remained at that milestone. No service, route, native engine protocol, owner profile
or database was manually changed for this slice.


The later combined source `41f60e91` now publishes these controls together with
the stored-evaluation preference. Exact canonical HTTPS entry and plan assets
match the clean build; workspace/tournament settings, owner enabled choice and
Serve routes are preserved. This supersedes the earlier unpublished build's
delivery status. Browser-rendered narrow/touch and physical-phone proof remain
open; see `STORED_EVALUATIONS.md` and the current delivery JSON.
