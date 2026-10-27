# Phone spacing, import and variation browser checks

`scripts/qa-phone-polish.mjs` builds the actual `WebApp` with a tiny invented PGN,
invented hosted-file manifest and isolated API responses. It launches a new
headless Chromium context, seeds only that context's IndexedDB, and blocks every
request outside the temporary loopback origin. It never uses the owner's Chrome
profile, phone origin, live APIs, personal library or evaluation corpus.

The final complete matrix passes all 44 checks with current source. Earlier
passes identified the Analysis view's full-width selector extending beyond its
margin box, a narrow Prep Strength label and enlarged engine metadata being
ellipsized. Focused corrections were checked, followed by the complete final
matrix. Engine name, performance label and status now remain readable at 200%
text. There are no outstanding failures in this harness.

- All six page destinations, plus Board's Moves, Database, Prep, Analysis and
  Coach views, are exercised at 320, 390 and 760 CSS pixels; a fourth pass uses
  320px with the root font enlarged from 16px to 32px.
- Measurements check page width, visible controls outside the viewport and
  button/segmented-control text extending beyond its label. Finite CSS
  transitions settle before measurement. Successful import notifications are
  dismissed through their real close button before layout screenshots.
- Real PGN paste/import opens a game through the parser, session and IndexedDB
  flow. Invalid paste keeps its draft; navigation retains an unfinished paste.
  A FEN import opens its exact starting position.
- Actual touch input after `1.e4` plays `c7-c5`. The active branch becomes
  `e4,c5`; the saved original remains `e4,e5,Nf3,Nc6,Bb5,a6`, with `c5` stored
  as its variation. Return to mainline restores the original, and tapping
  `1... c5` selects the variation again. The browser additionally waits for an
  actual rendered black pawn centered on c5 after Chessground's animation.
- The final browser run reports zero page errors and zero blocked external requests.
  Screenshots were visually inspected for Prep at 390/760px, Import at 390px,
  Database at enlarged text, Analysis at enlarged text and the actual variation.

Local evidence is under `tmp/phone-polish/renderer`: the full `receipt.json`,
`focused-receipt.json` and named screenshots. The runner supports
`PHONE_QA_DEPENDENCIES` pointing to the installed Playwright package root,
`PHONE_QA_OUTPUT` for a task-owned output directory and
`PHONE_QA_SCENARIOS=board:Prep,board:Analysis` for a focused correction pass.
Syntax, scoped formatter and lint checks pass for the harness.

The editable design review is in `design/phone-polish-20261027`. It includes
three directions, nine surfaces per direction, a shared state sheet and the
surface/state map. A refines the previously selected compact interface.

This evidence is browser/source verification. Deployment, live Novelty dev
content/archive reconciliation, phone service recovery and physical iPhone
verification have separate evidence and are not established by these fixtures.
