# Panel wheel scrolling parity

Novelty7bbe5984,77e5c052 and158ccf01 are one evolving behavior. The current
controller is carried through En's native/phone architecture in
utils/panelScrolling.ts. The actual src/index.tsx root selection mounts one
ApplicationRoot owner for either App or WebApp; its effect installs and releases
the controller. Separate dynamic imports and native/phone stylesheet preloads
remain intact. No preference, data migration, palette or layout is added.

## Motion and input ownership

Vertical wheel input animates the nearest scrolling surface, including portals,
SVG descendants and the visible-overflow document viewport. Repeated notches
retain distance and velocity. A critically damped90ms spring keeps a logical
subpixel position; each frame moves at most8px and0.48px per elapsed millisecond.
Elapsed time is capped at32ms, so a stalled frame cannot create a catch-up jump.
Line/page units, reversal, nested-boundary containment, rounding and external
scroll changes retain the latest Novelty behavior. Detached nodes and root
unmount cancel frames/listeners.

Modified zoom/horizontal, already-handled and noncancelable events stay native.
Reduced motion leaves wheel handling native and cancels pending animation when
changed. Missing animation/media-query support falls back to native scrolling;
legacy media-query listeners retain cleanup. Invalid synthetic numeric deltas are
ignored. Pointer/keyboard activity stops queued motion. Touch-move is not
intercepted, and scrollable textareas retain their text and selection.

En's main Board has its own move-navigation wheel handler, which does not
preventDefault. Its actual wrapper now carries data-board-area. The controller
also recognizes cg-board/cg-wrap, number inputs/selects and editable regions,
including empty/plaintext contenteditable. The controller never adds panel motion to a board-wheel gesture. Copying only Novelty's marker selector would miss En's
original board. No board-wheel preference or move handler is replaced.

## Verification and delivery

Two failures reproduced against the old ACTUAL entry for native and phone root
selection: neither installed the required bounded wheel behavior. Leaf root
components are mocked to isolate boot wiring; this is not native-window proof.
The same entry fixtures now verify interpolation and teardown for both roots.

Seventeen motion/queue/boundary/cleanup fixtures carry the current source cases.
Six actual-DOM fixtures cover En selectors and owner wheel handlers, SVG paths,
textarea value/selection, touch/reduced-motion changes, malformed synthetic input
and capability fallback. The malformed-event fixture overrides the event field
because normal WheelEvent construction correctly rejects nonfinite numbers.
All25 new checks pass. The combined phone/board/arrows/drawing regression run
passes500 maintained checks across69 files; full types, seven-file lint without warnings/errors
and three root-stylesheet guard checks pass. Browser inventory remains disabled;
rendered wheel/narrow/touch/native-window/physical-device evidence is separate.

Clean source cbbff3b8 independently passes the same500 checks/69 files and full
types. Its native package builds in2m58s with22 existing warnings; the exact
compressed boot, Board and App assets are embedded in the47,872,512-byte EXE
(SHA2562a558379a6a44a68247fc3d4b684d86a9245567408667a6c8af026c13a843e4e).
All102 bundled engine/source resources match the retained stage. No native
window observation or explicit Dev restart is claimed.

The canonical phone build takes22.30s and is live at the existing HTTPS address
from cbbff3b8, shell1bead00de081d3389751be6d25836c58a3653b63d839955996506e75c65b01de.
Exact boot/WebApp/Plans/Stockfish JS/WASM assets match; workspace, normalized
library content, tournament settings, enabled choice, engine-service PID and
Serve routes match the pre-publication snapshot. The existing publisher first
refused active background review; a later invocation passed its immediate idle
guard and returned normally. Only the home server restarted. The owned temporary
task was removed after terminal success. Review subsequently reported its own
required-depth error with one game pending; that review was not cancelled or
manually retried, and completed-review behavior is not certified by this check.

Once review and the remote worker were idle, an actual bounded Stockfish19 run
returned legal PVs and an exact chosen root score at depth8/50ms. Its worker alone
was released after a zero-busy check, preserving the service in cold standby.
No owner profile migration, corpus download or owner data reset was performed.
Rendered wheel/narrow/touch/native-window/physical-device evidence and the wider
history audit remain outstanding. Receipts are summarized in the delivery JSON.

The original primary report included27 extra cases from an ignored historical
snapshot at tmp/true-performance-integration, using its older performance module.
Normal Vitest discovery now excludes tmp snapshots. Those files remain intact;
maintained source/tests are unchanged. The corrected primary run passes500 cases
in69 files, matching the clean target collection. The earlier527 total is retained
only as historical scratch-inclusive evidence, not a wider product-parity gate.
