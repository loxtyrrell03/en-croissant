# Native evaluation data: layout options

The recovery/history audit confirmed a missing native evaluation data-management
surface. En already has a bounded optional builder and installed-store readers;
its Settings page has no reviewed download/recovery flow or validated source-folder
activation. The original Novelty flow separates optional acquisition from using
finished data and restores interrupted jobs without silently deleting them.

These three editable SVG sheets map that flow into En's existing Settings style:
the serif font and cyan primary colour from `src/styles/theme.ts`, existing dark
surfaces/borders and compact Mantine-style controls. No new visual identity is
introduced. All paths and numerical examples are invented. This is a native desktop
surface; its compact layout is a narrow desktop window, not a new phone download UI.

- **A — Settings row + dialogs (recommended):** an evaluation-data row in
  Directories; review, progress and recovery use existing dialog conventions.
  [Editable A workflow](a-workflow.svg).
- **B — Data workspace:** a dedicated Data tab with Current store, Download and
  Recovery subviews. [Editable B workflow](b-workflow.svg).
- **C — Source manager:** a table of the current store and download records,
  with inline expanded actions. [Editable C workflow](c-workflow.svg).

Each sheet includes main/compact layouts, review, running/cancelling, restored
interruption, cleanup confirmation/refusal, setup/loading/unavailable/completed
states and help. The [state map](STATE_MAP.md) specifies all affected states,
failure handling, ownership and scope. The owner selected **A — Settings row + dialogs** on
25 October 2026. Implement A consistently; no further layout approval is needed.
The B/C sheets remain review alternatives, not implementation targets.

SVG text widths are checked against the installed native serif font and the
sheets are rasterized for visual review without controlling a browser or app.
These remain prototypes of the UI. The native journal, process lease and guarded
recovery commands are implemented separately in
[EVALUATION_BUILD_RECOVERY.md](../../EVALUATION_BUILD_RECOVERY.md); reviewed
acquisition, persistent folder activation and the chosen UI remain to implement.
No real archive or owner data is changed by the prototypes or synthetic fixtures.
Rendered application interaction and delivery remain future gates.
