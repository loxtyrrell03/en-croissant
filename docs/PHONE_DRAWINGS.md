# Saved phone board drawings

Phone PGN imports retain arrows and circles from root comments and individual
move comments, including variations. Saved marks use Chessground
`drawable.shapes`; engine/review guides remain `autoShapes`. Both layers can
change independently, and the renderer receives fresh copies of saved marks.
Only the four portable drawing colours and legal square coordinates are stored;
piece/SVG/unsupported overlays do not become saved annotations.

The existing Moves annotation strip adds Draw beside Note. Tap two squares for
an arrow or the same square twice for a circle; choosing a colour and repeating
a mark recolours or removes it. Clear drawings affects the selected node. Tap
drawing disables move dragging and swipe navigation, and captures touches on
empty squares. Native right-button drawing remains available with Draw off.
The adjacent existing help component supports focus, touch and Escape.

Marks belong to a complete root/move-history/node identity inside their board
or Prep workspace. Transpositions and repeated positions do not borrow one
another's drawings. New/reopened board instances get an annotation owner id;
old callbacks cannot apply after navigation, source/Prep switching or board
replacement. Notes/glyphs use the same captured-owner guard. Half-finished tap
drawings reset on node, colour, mode or orientation changes.

The optional workspace `drawings` record retains marked branch nodes even when
the active line changes. Root/move drawing fields retain imported annotations.
The existing root-owned workspace transaction saves both; failed commits retain
the newest state for its existing Retry save path. No second database or saved
data migration is required. Older source-bound workspaces recover missing
drawing fields from their original PGN when read.

For a source-bound game, each edit legally replays its complete root/path before
finding or creating the exact portable node. Only that node's drawing tags are
replaced. Notes, glyphs, clocks, evaluations, timestamps, other nodes and side
lines survive. Root diagrams and unplayed custom/Black-to-move FENs round-trip.
Prep/draft drawings stay in their own workspace. Creating Prep from a board
carries its actual starting FEN, root drawings and marked branch history. Ordinary phone board taps and
play retain saved marks; removal is explicit. Desktop's existing erase-on-click
preference is unchanged by this phone slice.

Fifteen new checks cover ownership/portable persistence and actual WebApp plus
Chessground rendering/handlers. The latter uses controlled JSDOM geometry and
fixture-only synthetic input permission; production keeps Chessground's trusted
event check. Related phone annotation/parser/report/storage checks bring the
selected suite to 85 tests across eight files. One old Strength fixture expected
the obsolete label Engine best; the same failure was reproduced on clean HEAD
and its assertion now matches the existing Local eval best provenance wording.
That expectation repair changes no scoring behavior.

Types and scoped lint pass; WebApp retains its 25 baseline warnings. Clean
build confirmation is recorded separately. Browser control remains disabled in
Work settings, so 320/390px, large-text and real touch/focus layout verification
and runtime delivery are pending. JSDOM SVG/interaction checks are not physical
phone or browser screenshot proof. A fresh HTTPS read observes the concurrent tournament publication from
`dfc21831` (see `TOURNAMENT_PREDICTION_HISTORY.md`). It includes the earlier
Analysis source, but excludes this new drawings slice. Its Analysis rendering
has not been verified by this audit. Delivery identities are recorded separately
in `NOVELTY_SYNC_2026-10-24_DELIVERY.json`.
