# Tournament prediction history

The owner selected a player page with Next round and Past predictions, simple wording and minimal secondary text. Novelty's editable reviewed proposals and full surface map are in its docs/design/tournament-prediction-history folder.

En Croissant desktop and phone share TournamentPredictions, predictionHistory and predictionHistoryStore. The archive lives in IndexedDB in each app/browser profile; read/write transactions merge captures and official observations without writing native tracker or Library data. Separate desktop/phone histories are intentional. Keep the first and two latest distinct completed forecasts, then freeze the round when pairings are observed. Never regenerate a historical forecast from current standings. Missing history and unknown chance are explicit. Stable identity, partial publication, byes and corrections retain source-evidence semantics.

Browsing another entrant does not change the owner's entry or Prep colour. Past comparisons show the original top choice, official opponent, original shortlist rank/chance and colour. Detailed shortlist/capture times and player statistics are collapsed; direct preparation actions remain. Save failures stay visible and retryable. The store stops with an explicit error at 2,000 player-round groups, 4 MiB/event or 32 events; it never automatically deletes archives. Histories survive unfollowing and are local app-origin data.

Verified in primary: 328 tournament tests, complete TypeScript, actual desktop Modal and embedded phone paths using the real worker and IndexedDB, including 360/390 px, enlarged text, official changes, save retry and reopen. The executable/hosted phone deployment is recorded separately. No predictor weights or native/import protocols changed.

Run Novelty scripts/qa-tournament-prediction-history.mjs with this checkout path and optional phone argument; the script creates only ignored synthetic browser fixtures and receipts. It uses existing Novelty Playwright dependencies. Unit regressions are in src/features/tournaments/tests/predictionHistory.test.ts.
