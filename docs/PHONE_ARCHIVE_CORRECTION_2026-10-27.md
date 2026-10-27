# Phone Archive, resets and update delivery

The owner reported that the prior phone update still looked unchanged and that
archived sources remained visible. The server was serving product473455d5, but
that readback did not identify the release loaded on the physical phone.

The previous Show archived control mixed active and archived content. Archive
now shows only archived entries, plus folders needed to reach nested archives;
Back to active switches back. A newly listed child inherits a known shared
archived parent even before its exact target appears in the next snapshot.
Saved shared imports retain their collection identity in source filtering.
New folder reads use the chosen view; existing explicit sources/Prep stay open.

Reset position and Reset line are visible below the board. Reset position returns
to the game/FEN/Prep start without deleting a line. Reset line returns to the
mainline at the branch point, retaining the variation and annotations. The old
ambiguous icon could clear a blank analysis board; that destructive path is gone.

The old update checker awaited worker registration before checking the build and
had no open-window polling. Actual prior code fails the new regressions: zero
version reads with a stalled registration, and only one read after a publication
while the window remains open. New checks are bounded, independent of worker
registration, and repeat while visible. An update-ready action saves the workspace
before reloading; failed saves keep it open. The pasted PGN/FEN draft survives
reload and must match persisted bytes before that action proceeds. Active use no
longer triggers an automatic release reload.

Verification:43 focused cases/eight files and full TypeScript pass.54 browser
checks cover all six pages/five board panels at320/390/760px and200% text, nested
exclusive Archive, actual touch variations, both resets, branch re-selection,
and a real IndexedDB reload retaining workspace and pasted text. No page errors
or external requests occurred. The first visual pass found reset-label clipping
at200% text; wrapping whole buttons fixed it and the complete matrix then passed.
WebApp retains its25 pre-existing lint warnings, zero errors. Other changed
production modules and the QA runner pass scoped lint without warnings.

Editable review: `design/phone-polish-20261027/archive-reset-correction.svg`.
Local receipts/screenshots: `tmp/phone-archive-correction/renderer`; prior-code
failure evidence: `tmp/phone-archive-correction/old-upgrade-regression.log`.
Live delivery is recorded separately after publication. No physical-phone result
is established by these browser fixtures. No owner file/database/archive label was
changed for testing.

Product115ad758 was published and read back over canonical HTTPS:12 exact assets
from the444-file manifest,15 runtime modules, two generated modules and two native
helpers match. All seven guarded owner files, Serve routes and the personal sync
task remain unchanged. Home and gateway process identities stayed37552/9856.
Sync reports no errors/conflicts. Connected Chrome at390px shows the two shared
archived file roots and routes into archived database groups, excluding active
entries. This establishes live browser delivery, not the physical phone version.

That live review exposed archive badges squeezed by long real folder names. The
refinement places metadata/status below the name and permits labels to wrap.
The expanded58-check browser matrix includes long archived names and routing
labels at200% text; all pass with zero page errors. Types pass and the same25
WebApp lint warnings remain. Final refinement delivery has a separate receipt.
