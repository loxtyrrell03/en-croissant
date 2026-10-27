# Phone spacing and import review

These editable SVGs use the phone app's existing charcoal surfaces, blue actions,
Segoe UI / system sans-serif typography, 8px corners and 44px touch targets.
All player names, games, counts and statuses shown are invented examples.

- [A: aligned inline controls](A-workflow.svg) refines the compact navigation
  already selected in `docs/PHONE_USABILITY_2026-10-25.md`. Mode, source, player,
  side and dates occupy clear rows. Tool buttons use equal columns. Import is
  directly visible, while secondary setup remains behind a labelled disclosure.
- [B: guided setup](B-workflow.svg) divides preparation into source, player and
  start steps. It reduces simultaneous choices at the cost of extra navigation.
- [C: summary plus editor](C-workflow.svg) shows a short setup summary and opens
  an editor with Apply and Cancel. It adds a draft lifecycle and more navigation.
- [Comparison](comparison.svg), [shared states](shared-states.svg), and
  [surface/state map](STATE_MAP.md).

Recommendation: A. It resolves the screenshot's broken labels and unrelated
button widths while preserving the selected compact page and board navigation.
The current task asks for spacing and button fixes; it does not require another
navigation architecture. B/C are alternatives, not implementation requirements.

Each direction includes Prep at 390px and 320px plus Import, Files, Board,
Events, Review, Stats and recovery/help. Shared states add first use, loading,
cancellation, archived/saved, conflicts, offline retry and existing removal
confirmation. The runtime remains authoritative for available features and exact
consequences; a mock status does not certify synchronization.

`generate.py` regenerates SVGs and offline PNG previews using existing local
Python/PyMuPDF. All five SVGs parse. The A prep preview, direction comparison and
full A workflow were visually inspected; no broken-word controls or overlap were
observed after adjusting the sample footer and recovery button spacing. SVGs are
review artifacts, separate from browser, deployed and physical-device proof.

Implementation spacing: 12px card padding, 8px related-control gap, 16px between
labelled groups, 44px control minimum, 16px text inputs. Use `minmax(0, 1fr)` grid
columns, whole-word labels and auto-height text. At 320px, stack source/player/
side rather than forcing fixed minimum widths beside each other. Long filenames
may wrap, but short control words must not break in the middle.
