# Stable live engine startup output

Novelty's September startup coalescing fix (58741060) is adapted through En
Croissant's native engine and two PC/phone streaming clients. No scores, search
budgets, engine choices or network/service configuration are changed.

Native analysis and desktop PC streaming keep at most two intermediate display
updates per second (500 ms windows). The first complete result is parked too,
allowing shallow startup scores to be replaced by the newest accepted result.
Phone live analysis retains its existing 120 ms update interval. These periods
preserve each target's existing display/IPC budget rather than adopting Novelty's
100 ms interval everywhere. Saved cloud evaluations still display immediately.

The native reader has a publication timer even when UCI output goes quiet. An
available new line wins at the boundary before publication; partial input stays
intact if the timer cancels `Lines::next_line`. Native complete same-depth exact
MultiPV snapshots continue advancing independently of display publication.
`get_best_moves` only exposes an already-published snapshot to a second caller,
preventing a cached read from bypassing the initial window.

Every new go clears pending/published output. Stop/quit discard pending display
updates. The pending-go boundary rejects superseded searches and post-bestmove
info. A valid final bestmove flushes the latest complete result immediately,
including searches shorter than a window, and remains available in the cache.

Desktop PC and phone streams use a request-owned coalescer with timer cleanup
and abort/ownership guards. An explicit `done` frame flushes immediately without
waiting for socket EOF, stops parsing later frames and releases the reader.
Legacy live streams ending at EOF still flush. Final publication cannot be
followed by a delayed startup timer. Phone live parsing now rejects both bound
markers for centipawn and mate scores, as native/desktop PC already did; bounds
cannot stand in for exact evaluations. Existing strict Plans/report evidence
validation, stored-evaluation precedence and phone execution-location policy
remain intact. This does not claim that ordinary live PV parsing has the stricter
report validation contract.

Verification: 39 frontend checks across six files include eleven new fake-clock
and actual stream-controller regressions for startup, quiet streams, short/done
completion, late frames, cancellation and retargeting. Whole-project types and
six-file lint pass without warnings/errors. Eight focused native checks pass,
including a separate existing local Stockfish process that completes two exact
MultiPV lines, reuses the process across a rapid stop/retarget, rejects late
post-final info and retains the final cache. Its display clock is held fixed to
make startup timing deterministic; real UCI parsing/searches are performed.
The full native Tauri check passes with 22 existing warnings.

The broad native suite is not green: changed source has 300 passes, 13 failures
and nine ignored checks. The unchanged clean baseline b01f15c1 has 293 passes,
the same 13 failures and eight ignored checks. The failures comprise seven
legacy evaluation assertions, five Coach tests and one puzzle interval test.
The additional ignored test is the explicitly run local-engine fixture, which
requires LIVE_OUTPUT_ENGINE. No new broad-suite failure was introduced; do not
report this as a full-suite pass or silently rewrite independent expectations.

These are source, synthetic stream and local-process checks. Browser control is
still disabled in Work settings. Rendered evaluation-bar/native-window evidence,
clean delivery verification and standalone/hosted publication remain separate.
No live app, hosted engine service, profile data, downloaded corpus or hosting
route was changed by this milestone.
