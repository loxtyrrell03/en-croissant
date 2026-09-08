# Private easy-course development audit

Date: 2026-09-08. Classifier: `site-55.adapter-39`; live pipeline: 41.

The user supplied locally downloaded Woodpecker Method PGNs. The easy section contains 242 parsed PGN records, of which 222 have a FEN and a nonempty, completely legal solution mainline. No eligible mainline was rejected. The source text SHA-256 is `e10dfda1d0463c1d91d375a04d891021dce997663c913a634a53804c5091b5e4`.

Source PGNs, course annotations, sampled positions and detailed engine reports remain **outside this repository**. Do not publish them. This document contains only method, aggregate results and follow-up categories. The scripts contain synthetic tests, not course content.

## Selection and independent judgement

A fixed equally spaced sample selected 24 of the 222 legal exercises, including both endpoints, before classifier outputs were inspected. Comments and side variations were not used as expected labels. Independent first-pass chess judgements were recorded privately before fresh analysis; uncertainty was retained rather than forcing every position into a theme.

Each reached position was analysed in a fresh Stockfish 18 process at depth 16, MultiPV 3, one thread and 32 MB hash. A source root absent from the top three received a separate restricted search. Source and engine continuations were legally replayed. The harness checks execution and legal data, **not classification correctness**. Human review remains necessary.

This is a development sample of easy exercises, not a holdout, a random sample of ordinary games, a comprehensive taxonomy test, or thousands of tested tactics. It does not establish interference, trapped-piece or zugzwang coverage. Existing conservative zugzwang abstention remains unchanged.

## Findings

- Eleven of the 24 live main headlines were empty. Thirteen were nonempty, but this is **not thirteen correct classifications**.
- Several nonempty results name a later fork/discovered attack without explaining the root attraction or preparation. A generic Sacrifice headline also obscures a subsequent checking-fork mechanism.
- Some source mating continuations can be avoided by conceding material. The correct lesson must cover that alternative; attaching a forced-mate label solely from the course solution would be wrong.
- Direct attraction, some forcing mates, clearance, removing a defender and discovered attacks are already found in parts of this sample. Each requires a position-level judgement rather than agreement with course terminology.
- One missed knight fork wins the exchange while conceding a countercaptured pawn. The shown line gains only 80 cp under the local piece-value model, below the immediate fork proof's 100 cp gate. This exposes a plausible threshold problem, but does not prove that changing that threshold alone handles every legal defence. No unverified threshold reduction was shipped. Full-position engine scores must not be equated to this local exchange count.
- More complex exchange-deflection, overloaded-defender and mating-threat preparations remain unresolved. Full before/better/played causal comparisons have not yet been built for this course sample.

These findings contradict completion of the broader accuracy goal. Do not turn empty results into passing tactical expectations, select only successful exercises, overwrite the blind baseline or claim a benchmark pass means the right lesson was selected.

## Reproduction

Use a private output directory outside all checkouts. The sampler resolves existing ancestors/junctions, refuses this checkout, and exclusively creates its output so a previous baseline is not overwritten.

```powershell
node scripts/benchmarks/private-pgn-sample.mjs "<local easy-section.pgn>" "<private-directory>/blind.json" 24
node --test scripts/tests/private-pgn-sample.test.mjs
$env:TACTICAL_JUDGEMENT_ENGINE = '<local Stockfish executable>'
$env:TACTICAL_PRIVATE_PGN_SAMPLE = '<private-directory>/blind.json'
$env:TACTICAL_PRIVATE_PGN_REPORT = '<private-directory>/new-engine-report.json'
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalJudgement.test.ts --environment node -t 'privately supplied fixed PGN'
```

The engine-report directory must already exist. The opt-in test refuses an existing output and this checkout, including resolved parent junctions, before starting engines. It saves incremental progress for its own new report. The original and replay reports both completed all 24 cases (the final hardened replay took 18.09 seconds of test execution on this host). Six synthetic sampler tests and targeted lint pass. No classifier, cache version, generated worker, app process or deployment was changed by this audit milestone.

The next useful implementation work is independently proved root preparation with alternative material-concession branches, plus material-threshold reasoning that distinguishes a meaningful exchange-for-pawn fork from near-equal exchange noise. Retain both positive and defensive controls and re-run the frozen ordinary-game/worker sets before accepting changes.
