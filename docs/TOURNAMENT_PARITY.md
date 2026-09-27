# Tournament tracking and opponent preparation

The desktop Home screen and phone Tournaments workspace share Novelty's current tournament feature implementation. Novelty was read only, including its uncommitted working-source improvements; the audit receipt and verification command are in `docs/design/tournament-parity-20260927/README.md`.

## Features and adapters

| Feature | En Croissant implementation |
| --- | --- |
| Discover/search events, dates/regions/countries, event metadata and links | Original views and native readers in `tournament-core` |
| Follow events, exact roster identity, entry refresh, rounds, standings/results, tracking settings | Shared tournament store and original identity/lifetime checks |
| Swiss/round-robin forecasts, score/colour scenarios, published pairings, confidence/help | Original model, workers and replay fixtures; exact Swiss 5.0.0 / tournament 3.3.0 dependencies |
| Import a predicted/published opponent, selected players or full roster | Exact FIDE identity, persistent request/checkpoint, one deduplicated job, stable database per opponent |
| Seven OTB sources, year selection, progress, stop, incomplete coverage and retry | Existing En Croissant collector retained, with immutable downloaded archive-index support added |
| Downloaded OTB library, updates, enable/disable, retention, cancellation/removal | Original reviewed OTB-only download manager; shared existing OTB cache, no evaluation corpus copies |
| Import & prep / Open Prep / Open database | Native database and tab adapters; durable phone database and saved Prep adapters with projected/published colour |

Source transfers are recorded in `port-manifest.json`. The En Croissant collector already contained stronger timeout, corpus-hole, advertised-coverage and identity checks than Novelty's collector; it was extended rather than replaced. Imported database rows are editable and remain isolated from immutable downloaded source indexes.

## Persistence

The service owns only its tournament SQLite metadata. Native imports first collect into a job-specific PGN, then publish an owned database using `saveOtbDatabase`. Refreshes use an atomic append with a source fingerprint and job receipt. Existing rows, annotations and game IDs survive duplicate updates. Save failures retry the same retained artifact.

Phone imports use the existing durable, idempotent OTB job API. Games append into one stable opponent database, preserving existing IDs and Prep notes. A job receipt prevents replay from resurrecting games deliberately removed by the user. Completion waits for browser storage to finish. Closing/reopening the form restores the saved checkpoint; a completed import offers Open Prep without fetching again. General player imports retain their request key too.

Roster checks still run before attaching a completion. Unfollowing/removing a player during an import cannot attach its late result to a different tournament identity. Stopped or partially covered imports expose their saved games and warning instead of claiming complete coverage.

## Verification and delivery boundary

The source checks passed 376 frontend fixture tests, 76 native collector tests, 60 native service tests (two opt-in live tests skipped), and the focused import/save service suites. Whole-project TypeScript and a production Vite build passed. The synthetic browser fixture at 360px followed an event, computed round-five predictions, imported its selected opponent and opened Prep as Black with the opponent's opening moves available. Navigation fits without label overlap or page overflow.

The QA server (`scripts/serve-tournament-qa.mjs`) uses invented data and intercepts all APIs; it does not contact providers or import owner games. No full corpus was downloaded or copied. Build and source checks do not certify physical-phone interaction or a live deployment. Release verification is recorded separately after publication.

The source checkout contains unrelated unfinished changes. The release must preserve the live phone service-control commits and canonical controller route; never publish an older branch over that runtime or bypass the clean-source/ancestry guard.
