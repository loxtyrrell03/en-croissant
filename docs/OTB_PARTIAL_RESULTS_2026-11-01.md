# OTB source failure resilience

The collector had saved useful PGNs, but the home-server service discarded the
whole result whenever a source reported incomplete coverage. Two retained failed
imports contained 51 and 106 verified games; both had a Lichess403 source gap.

The service now publishes playable available games as a distinct terminal
`partial` status. The raw report and original records remain intact. Updated
phone/tournament consumers fetch its artifact and preserve coverage metadata in
saved Prep databases. Warnings distinguish incomplete, unknown and stopped
coverage. The importer offers Retry same sources using the exact saved request.
Older cached clients reject the new status instead of labeling it full coverage.

No playable games with incomplete/unknown coverage remains a meaningful failure,
including header-only and invalid-FEN output. Collector completion waits for
stdio close so buffered final reports are not missed. Stop remains authoritative
while preparation and atomic artifact writes are pending. Restart recovery derives
completed versus partial from the saved report rather than assuming completeness.

## Verification

- 39 backend tests: `node --test scripts/tests/otb-import-service.test.mjs
  scripts/tests/otb-import-start.test.mjs scripts/tests/home-server-otb-start.test.mjs`.
- 35 frontend tests in7 files cover coverage, artifact loading/Stop races,
  actual WebApp handoff, Prep merging and tournament identity/handoff.
- Whole-project TypeScript check passes.
- `scripts/qa-otb-partial-results.mjs`:7 built-browser cases, real IndexedDB reload,
  exact original request retry,320/390/760px. `scripts/qa-tournament-import-prep.mjs`:
  12 cases including incomplete-result explicit Open Prep. Both have zero page
  errors/external requests. Set `FIDE_QA_DEPENDENCIES` to an existing Playwright
  installation's package.json; receipts/images stay under ignored `tmp/`.
- `scripts/check-otb-retained-output.mjs` accepts explicit failed job JSON paths
  and replays their exact saved PGNs into a small temporary service. Both retained
  imports produced partial artifacts with all51/106 raw and prepared games. SHA-256
  checks confirmed the original job files and PGNs were unchanged; temporary replay
  outputs were removed. The script does not repair or mutate owner jobs.
- Independent before/after tests proved the previous service fails buffered stdout
  drain and delayed Stop cases; the revised service passes both.

## Delivery and limits

The combined phone assets and changed home-server/OTB modules are now published
from clean e568afae, with an actual home-backend restart. A fresh exact-source
import returns51 playable prepared games as explicit partial; the original failed
jobs and PGNs retain their hashes. No native rebuild was needed. Existing routes,
service roots, owner On/Off state, saved workspace and shared data are preserved.
See `PHONE_FIXES_2026-11-01_DELIVERY.json`. Physical-phone proof is outstanding.

Lichess's403 restriction itself remains; no security challenge was bypassed or
source silently disabled. Its official FIDE metadata API does not provide an
equivalent global game-discovery replacement. Partial availability is explicit
and retryable. Already-imported pre-upgrade receipt shortcuts preserve their saved
state; they do not silently backfill missing coverage provenance. Historical jobs
loaded afresh without coverage reports display unknown coverage.
