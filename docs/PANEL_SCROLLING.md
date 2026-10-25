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
including empty/plaintext contenteditable. Thus it cannot both navigate a move
and scroll an ancestor. Copying only Novelty's marker selector would miss En's
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
passes527 checks across70 files; full types, six-file lint without warnings/errors
and three root-stylesheet guard checks pass. Browser inventory remains disabled;
rendered wheel/narrow/touch/native-window/physical-device evidence is separate.

Clean desktop/canonical-phone builds and runtime publication are pending and
tracked in the delivery JSON. No explicit app/service restart, owner profile
migration, corpus download or owner data operation was performed by these
fixtures. Normal development watching may serve changed source; no live native
window observation is claimed. The broader history audit remains active.
