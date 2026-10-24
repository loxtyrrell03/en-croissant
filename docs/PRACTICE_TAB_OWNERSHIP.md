# Practice keeps its source analysis

Play from here, Practice against bot and Blindfold trainer create a new,
unbound play tab from the selected node's exact FEN. They preserve the original
tab, source identity, full tree, annotations, variations, dirty state and game
settings. The new root retains the starting turn and fullmove counter; it starts
with fresh game headers/report data rather than inheriting the source result.

The new tab's blindfold state is initialized by its own ID before activation.
A manual selection during creation stays selected. Bot/Blindfold setup retains
the existing Patricia/Maia and side-to-move defaults; ordinary Play from here
retains the existing general opponent preferences and board perspective.
Analyze game subsequently changes only the new play tab's type, retaining its
unbound save destination. A missing/closed tree owner fails without changing the
active board. No native file or database is written by these shortcuts.

Twelve regressions exercise all three shortcuts against file/database sources,
custom Black-to-move fullmove 37, source variations/dirty annotations, activation
races, closed sources, real React hooks and the actual Play/Analyze controls.
Related save/open/preview and bot checks total 68 across eight files. Full
TypeScript and six-file lint pass without warnings or errors. Native APIs are
mocked in component fixtures; this is source evidence, not native-window or
rendered-browser verification. The hosted phone has no corresponding native
multi-tab practice shortcuts; its root-owned workspace writer stays separate.

Clean delivery `9b2d0b5a` independently passes the combined 95-check,
eleven-file suite, full TypeScript and the production Vite build (22.56 seconds).
All 24 owned source/test files match the primary milestones. Eighteen-file
combined lint has zero errors and the existing TournamentCard unused-variable
warning. Database source `b8b1bb3a` also passes all seven native SQLite/protocol
checks and the complete native Tauri check (22 existing warnings). These native
files are unchanged in the later practice/Clear milestones. No standalone or
hosted release was published by these milestones; rendered/native-window
verification remains separate.
