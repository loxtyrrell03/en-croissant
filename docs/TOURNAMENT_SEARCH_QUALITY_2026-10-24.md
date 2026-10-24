# Tournament search quality — 24 October 2026

Tournament search now remembers the owner's chosen area across app sessions and retrieves more candidates before ranking approximate words. No tournament identity, published date, score or player data is inferred.

## Behavior

- Persist only region and country, with validation and graceful session fallback. A new session starts with fresh dates and an empty query. Clear filters deliberately clears the saved area.
- Normalize accents, punctuation, common event abbreviations and under-age/rating notation. Match reordered words and split/joined place names; allow bounded spelling mistakes and unfinished words. Ignore conversational connectors and generic chess/event wording only when specific terms exist. Require all remaining terms; never approximate numeric sections or years. Published start/end years are searchable when missing from titles.
- Cache event vocabulary and word-distance work per query. In-flight directory reads are shared while typing. Successful source requests expire after five minutes; cache size is bounded to 60 requests and visible query results to 20 entries. Retry invalidates source requests; an older completion cannot refill a cleared cache.
- A capped browse page receives no more than six supplemental lookups: the phrase, distinctive words, spelling candidates from observed vocabulary, short fragments, and a venue lookup where no explicit location was selected. Two run at once. Merge by tournament ID, display successes progressively, preserve partial successes when another request fails, and stop starting queued requests after cancellation. In-flight transport may finish for caching, but cannot display a cancelled result.
- All / Any date and Search all dates expose a past/ongoing lookup without discarding the area or query. Explicit geographic, time-control and date filters remain authoritative. A source-cap warning remains visible; this is not an exhaustive Google-scale web index.

## Verification

- 47 focused tests in each product and in the isolated Novelty search branch cover matching, exact numeric constraints, persistence/reload/corrupt or unavailable storage, shared reads/TTL/retry, partial failures and cancellation. Both primary project type checks and the clean search branch type check pass.
- The current Novelty Dev origin was verified against its checkout identity and passed the actual-component browser runner. The existing Novelty discovery browser runner passes. The new actual-component runner passes Novelty, En desktop and embedded phone at 1100/560/390/360px, with no page errors or unexpected external requests. Source responses/settings in browser QA are synthetic and isolated from owner data.
- A read-only UK/Ireland source lookup returned 147 upcoming events from 254 rows, with no cap. Six real-listing checks find Uxbridge, Kingston, the English Championship, Coulsdon Under 12, Birmingham New Year and Central London using rough words. A 2,000-event synthetic enlargement of those listings took about 67 ms to rank on this PC, compared with about 271 ms before the per-query cost cache; this is a local measurement, not a cross-device latency guarantee.
- A cold worldwide lookup for `birminghm congress 2027` initially received 2,000 source rows and 925 in-window events, none matching. Literal phrase and misspelled-name queries returned zero. Fragment and congress lookups recovered published tournament 1519123 (Birmingham New Year FIDE Congress); the complete browse-plus-search took about 4.1 seconds. The original date/geographic filters and source-limit warning were retained.
- Live transport checks reused the retained 25 September native discovery executable with the unchanged discovery API/form/parser path. A fresh optional native-harness compile was attempted but its cached Rust dependency graph could not resolve futures_util/reqwest/scraper. No native source changed in this feature; that harness failure is not represented as a successful native rebuild. Compact live receipts and isolated screenshots are under tmp/tournament-search-20261024 and tmp/tournament-search-quality.

## Delivery

Changes are present in the primary Novelty Dev source and shared En desktop/phone source. The isolated Novelty branch contains only this task's changes; the dirty primary checkouts retain unrelated work. This task does not publish an installer, deploy the hosted phone runtime, restart services or modify owner databases. Browser/component proof does not establish installed-executable or physical-phone interaction.

Reproduce browser checks with `node scripts/qa-tournament-search-quality.mjs [repository-path] [phone]`. Set `NOVELTY_QA_ORIGIN=http://localhost:4780` to verify the current primary Dev modules after checking its checkout identity; the harness still uses an isolated test browser and synthetic responses.

The parity audit carries primary `3e504902` into clean delivery source
`58e1c55c`, retaining the native PGN safeguards and all earlier phone changes.
The five selected search/model/persistence suites pass 44 checks; combined with
the PGN/preview/report/phone regressions, 137 checks across 22 files pass, plus
full types and the production Vite build (23.46 seconds). This combined-source
check does not rerun the feature browser receipts above or publish either app.
