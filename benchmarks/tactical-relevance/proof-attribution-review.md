# Connected proof attribution — adapter 166 / pipeline 173

Verified in the En Croissant fork on 2026-10-02. This milestone changes its shared classifier, used by live Tactics and Mistake Review. It does not migrate or deploy the separate Chess Mistake Trainer website.

## Corrections

- **Discovery must earn its own payoff.** `proveExchangeDiscovery` may collect newly uncovered ray targets and targets attacked by the moved piece. An unrelated, already-existing attack by the slider cannot finance a failed discovery. The Re8+ contrast retains the forced deflection but abstains when ...Kh7 declines it; Qxf7 on an already-open file is not evidence for the newly opened diagonal.
- **A pawn capture may create the passer.** `provePromotionCombination` now nominates advanced pawns with a legal adjacent-pawn capture leading to a passed-pawn route. Nomination is not proof: the existing bounded all-reply search, settled gain, counterpromotion and liability checks still apply. The promotion example is retained even if a declined-sacrifice branch is longer. The extra-rook refutation still abstains.
- **An optional mating branch is not the root mechanism.** The legacy king-attraction nomination may replace a proved mate only when every legal reply captures the bait with the king. Qh6+ has both ...Kg8 and ...Kxh6, so its primary lesson remains Forcing Mate regardless of which reply appears in the supplied line. Rh3# still carries its Anastasia pattern at the actual later ply. The starting board shows Qh6+, not an arbitrary defensive branch.

No search budgets, worker deadlines or cache limits were increased. Adapter and live-pipeline versions were advanced to invalidate stale classifications. Existing forced-attraction and discovery/promotion controls remain intact.

## Frozen targeted benchmark

`src/utils/tests/tacticalProofAttribution.test.ts` contains six position/branch contrasts and their colour reflections (12 root-primary contracts), plus four proof-budget contracts. The mating position reuses the repository's retained Lichess-puzzle regression; the deflection and promotion contrasts are constructed controls. Judgments are engineering adjudications, not independent population labels.

| Contract group | Before adapter 165 | After adapter 166 |
| --- | ---: | ---: |
| Correct root primary or deliberate abstention | 6 / 12 | 12 / 12 |
| Proof scope, promotion witness and budget contracts | 0 / 4 | 4 / 4 |
| Total | 6 / 16 | 16 / 16 |

The original and reflected positions are related cases, not independent samples. Within the four deliberately negative root cases, false tactical roots fall from two to zero. Two missed promotion combinations are recovered; two branch-dependent wrong primary themes are corrected. Do not convert these deliberately selected cases into general precision/recall claims.

Immutable before/after case results, exact lines and proof witnesses are in `proof-attribution-adapter165-before.json` and `proof-attribution-adapter166-after.json`. To record a new comparison, set `TACTICAL_PROOF_ATTRIBUTION_REPORT` to a **new** output path and run:

```powershell
node node_modules/vitest/vitest.mjs run src/utils/tests/tacticalProofAttribution.test.ts --maxWorkers=2 --update=none --cache=false
```

The report refuses to overwrite an existing file and identifies the classifier version and normalized core hash. Keep the judgments fixed; review disagreements instead of updating expected labels to match output.

## Wider verification and scope

- Public classifier regression: **2,990 passed, one expected failure, 364 conditional skips, zero unexpected failures**, across 216 selected files (195 passing, 21 skipped). Selection: `rg -l 'tacticalMotifs' src/utils/tests --glob '*.test.ts' --glob '*.test.tsx'`. Run with two workers, no snapshot updates and no private/fresh-engine/built-worker opt-ins. Runtime 181.83 seconds is test completion time, not application latency.
- Frozen lesson priority: **32/32 primary theme/source matches**, five secondary lessons retained; colour reflections pass separately. The cases cover 17 primary themes, including clearance and intermezzo. They reuse frozen depth-16 real-game and constructed scenarios; this is not a fresh engine audit, an independent holdout or all-54-label accuracy. Per-theme counts are retained in `proof-attribution-verification.json`.
- Staged-only core: **177 passed / five skipped** across attribution, discovery, promotion, mating clearance, mating capture replies, lesson priority and both consumers. An exact-module test loader substituted the staged core in memory, asserted the pending checking-ray patch was absent, and confirmed the index and working core were unchanged. This establishes independence from the user's unfinished checking-ray work.
- Generated shared-review service: **39 passed / one opt-in engine skip**, using temporary synthetic stores, including deck export and reload. Full TypeScript, focused lint (zero warnings/errors), and `npm run build-vite` passed.
- The first wide run exposed two outdated Qh6+ consumer expectations. Only those expectations and the starting-board arrows were corrected; the later Anastasia assertions were retained. No classifier code changed between the first and final wide runs.

Known expected failure: `promotionCountercheckRecall.test.ts` retains the unresolved queen-ending checking-race promotion case. The three fixes do not establish complete tactical recall, perfect primary-theme selection, zugzwang proof or broad positional false-positive rates. Longer preparations and independently adjudicated per-motif holdout coverage remain follow-up work.

## Source and delivery boundaries

The checkout already contained a separate checking-ray deflection patch (46 added / four removed core lines) and its untracked test. They are preserved **outside** this milestone commit. The before/after JSON and broad/build/service checks describe the full working source including that patch. The staged-only run separately proves this milestone without it:

- Before working core, LF SHA-256: `d163b6ee39d23162dee4a68605bb9ac339667be191ce4dec2acea38aa9b8d163`.
- After working core, LF SHA-256: `957f6f798f18835585ce7362afd1fc2fadd14869899c56ececa2f3cd30a0f5c4`.
- Milestone core without pending checking-ray patch, LF SHA-256: `57736a80c8dbbf4d225d409f4daaa039dab1a0344a23dace4fd8d1bed50239bd`; Git blob `64e607b0ae1054e6b8039ffea59b7f70c74f565d`.

The local frontend and review worker were built, not installed or published. Generated output is not included in this source commit. No native package, running app, owner-store rescan, phone service, hosting route, browser session or full-data corpus was changed. Installed desktop delivery remains the separate recorded adapter-164/pipeline-171 package until explicitly superseded by a verified delivery record.

Full temporary run details are retained under `C:/Users/Lox/AppData/Local/Temp/en-tactical-public-regression-693e0d898c6240b08c4ca4fb6a25789e` and the staged-only configuration/results under `C:/Users/Lox/AppData/Local/Temp/en-staged-proof-a35fcd5530294da096aa3aae3f584d85`. The compact committed receipts do not depend on retaining those temporary files.
