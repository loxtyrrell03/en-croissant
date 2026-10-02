# Truthful pairing probabilities: source verification

Estimated Swiss forecasts now withhold numerical chances before round one and when the source explicitly reports a missing prior pairing list. Candidate order, colours and preparation remain available. Unknown candidate/Other probabilities are `null`, with unavailable confidence; published pairs/byes, scheduled absences, round-robin schedules and ordinary unresolved live results keep their existing behavior. Complete source restoration restores later-round numbers. No fitted weights or ranking algorithms changed.

Both En Croissant desktop and its PC-hosted phone companion consume these shared components. Source verification is separate from installed-desktop delivery, live phone service verification and physical-phone testing; none of those deployments or runtime changes was performed.

## Verification

- Nine focused test files: **102 tests passed in each checkout**, both the reused feature checkout and primary after guarded mirroring. These cover forecast ordering and nullable chances, published/scheduled precedence, source-restored and irrelevant-flag states, score/participation behavior and real Tracker/Prep rendering.
- Project TypeScript: **passed in both checkouts** (`node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit`).
- Feature-checkout actual Tracker and Prep row with the native Mantine dark theme, headless WebKit: **eight surface/viewport groups passed**, at 1280/760/390/360 px; the last two emulate touch input. Opening, incomplete, complete, refreshed and published states show the intended labels. Help supports focus, click, Escape and outside dismissal and stays within the viewport. Preparation actions invoke the supplied callbacks. No horizontal overflow, page errors or external requests occurred. Desktop and narrow-phone screenshots were inspected. This browser run was not repeated in primary, whose sole unrelated Tracker copy difference was retained.
- Browser harness isolates native/profile APIs and asynchronous workers with synthetic data; it proves shared component behavior, not the running native app, native bridge or hosted phone endpoint.
- Four-event cross-target parity: **all 11,403 fallback states across 316 snapshots match current Novelty and the saved public baseline**, including candidate identity/order, probabilities, colours, Other, kind, round, confidence and displayed labels. Seven executable TS kernels match after erasing types and normalizing import suffixes/formatting; six weight files match as parsed JSON. Installed `@echecs/swiss` (35 files) and `@echecs/tournament` (7 files) match byte-for-byte. This check runs no exact worker; full timed worker replay is owned by the separate Novelty benchmark.

Compact source-hashed receipts: [component QA](PAIRING_PROBABILITY_QA_20261002.json), [cross-target parity](PAIRING_PROBABILITY_PARITY_20261002.json). The complete four-event corpus has no explicit incomplete-history flags, so abstention behavior is covered by synthetic missing-row regressions; unchanged corpus output alone does not establish that behavior or improved calibration.

The focused files are `firstRoundProbability`, `probabilityAbstentionPresentation`, `firstRoundPresentation`, `pairingEstimateHelp`, `pairingForecast`, `publishedNoOpponentScore`, `swissParticipation`, `TournamentTrackerView` and `TournamentPrepStrip` under `src/features/tournaments/tests`.

## Reproduction and small receipts

`node scripts/qa-pairing-probability.mjs --tools-root PATH_TO_EXISTING_PLAYWRIGHT_CHECKOUT` reuses an already installed Playwright dependency, launches an isolated ephemeral loopback Vite fixture and closes it afterward. Synthetic fixture, screenshots and compact `proof.json` stay in ignored `tmp/pairing-probability-qa`. No dependency copies or app build are required.

`node scripts/check-pairing-probability-parity.mjs --novelty PATH_TO_NOVELTY_RESEARCH_CHECKOUT --tools-root PATH_TO_EXISTING_ESBUILD_CHECKOUT --baseline PATH_TO_BASELINE_PREDICTIONS_GZ` compares both products on the four-event, all-round replay. It uses the existing visibility-audited builder and fixture file read-only, compares candidate identity/order, colours, probabilities, displayed labels, Other, kind, round and confidence, and checks unchanged kernel/weight/dependency hashes. It does not run any whole-field workers. Tiny bundles and a compact receipt stay in ignored `tmp/pairing-probability-parity`.

Source mirroring checked fresh byte hashes before writing any file: eight existing touched files matched the feature baseline, while Tracker required only the null-Other guard delta so its existing game-count wording survived. New files had to be absent or identical. Per-file original byte hashes and the 17-file mirror receipt are retained in ignored `tmp/pairing-probability-qa`. The unrelated dirty primary source and root `AGENTS.md` were preserved.
