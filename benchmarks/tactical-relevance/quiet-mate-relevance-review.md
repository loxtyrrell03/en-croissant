# Quiet mating setups: stable primary lessons and less fork noise

Adapter 104 / live pipeline 109. Source/build milestone, not an installed-app
release or a claim of complete classifier accuracy.

## What changed and why

A quiet move could receive different primary themes depending on whether its
engine continuation happened to contain five plies ending in mate. The same
root was either empty, a material fork, or Mating Preparation. The existing
mate-in-three verifier now searches quiet roots independently of PV length and
ordering. It covers every legal defence through two further attacking moves,
including quiet second moves, counterchecks, interpositions and promotions.
Actual checkmate is required at every leaf. Capturing/checking entries retain
their previous nomination rules. The 16,384-operation allowance and production
worker deadlines are unchanged; exhaustion cannot certify a mate.

The proof now exposes every selected attack and every covered defence, rather
than only one illustrative line. Separate replay tests reconstruct all branches
and require exact equality with the legal defence sets. Capture-first,
colour-stable ordering and check nomination at mate-in-one leaves bound the
work without treating engine evaluations as proof. Invalid limits, stalemate
and claimable fifty-move draws cannot borrow a cached certificate.

My primary-theme judgement is outcome- and evidence-specific: a proved forced
mate is more important than a nominal material fork whose safety itself relies
on that same mating continuation. This is not a blanket rule that every mating
PV erases forks. Genuine material-or-mate forks with non-mating defences retain
their existing lessons and regressions. Separately verified interference stays
secondary, with its cut defensive line and mating-threat arrows. A generic
Mating Attack badge is not repeated beside its stronger root mate certificate.

Quiet root mates no longer acquire arbitrary future reply arrows when the PV
is longer. The setup arrow remains; specific same-ply interference geometry is
preserved. Mating endpoints and an actual underpromotion remain on their own
plies. Missed-move review uses the stronger root preparation while preserving
the independently supported interference detail. This change does not establish
new causal comparisons against unproved alternatives.

## New real-game sample and independent judgement

The [nine-game development sample](quiet-mate-development.json) was selected
without classifier imports from the first 100,000 rows of the
[official CC0 Lichess puzzle database](https://database.lichess.org/#puzzles).
It contains three distinct games in each quiet mate-in-two/three/four stratum.
SHA selection excludes every prior fixture puzzle/game, including the untouched
holdout, and existing benchmark games. The receipt records the prefix digest,
HTTP source identity and exact exclusions. This bounded prefix is not a random
sample of all chess positions. Source tags nominate candidates, not ground truth.

[Initial chess judgements](quiet-mate-initial-judgement.md) were written after
legal source replay and before classifier or new engine output. The
[retained adapter-103 baseline](quiet-mate-adapter103-baseline.json) reproduces
18 short/full source and live inputs without changing the working tree.

| Real game / root | Judgement and observed change |
| --- | --- |
| 06PHz, ...Kg3 | King support closes the escape before ...h2#. All five replies, including four promotion choices, are covered. Existing Mate Threat remains primary. Not zugzwang: passing would still allow mate. |
| 0XwFD, Ka6 | Supporting a7 prevents Kxa7 after b7+. All eight replies are covered. Existing Mate Threat remains; a bishop's inability to stop the pawn mate is not a separate promotion lesson. |
| 0iAUN, ...Nd3 | The knight closes king escapes before a knight mate. All nineteen replies are covered, with different mating squares allowed. Existing Mate Threat remains, not Fork. |
| 0IJ6I, ...Rg6 | The rook seals g-file escapes before ...Rh8+. All nineteen replies and subsequent interpositions are covered. Root-only output changes from empty to Mating Preparation. |
| 09Cf3, ...Kg3 | King support traps Kh1 before ...Rb1+; a rook interposition delays but does not prevent mate. All nine replies are covered. Root-only output changes from empty to Mating Preparation. |
| 0hHGN, f6 | Supporting Qxg7 and opening Bh6 after Bxf6 creates the mating setup. All 23 defences are covered, including quiet Bh6 after ...Nf5. Root-only Fork becomes Mating Preparation; the mating-backed Fork badge is also removed from the full line. The full-line primary was already correct. |
| 0z5nl, Kh3 | The king supports the checking pawn advance; the required exchanges make this mate in four. Still unproved by this bounded classifier path. |
| 0rcU4, ...Qh4 | ...Qe1 is threatened; a later rook exchange draws Nd3 away from e1. The later deflection is not a root fork. Mate in four remains a coverage gap. |
| 0QPvf, Rb8 | A mating battery permits a genuine ...Rf1+ countercheck before the back-rank finish. Mate in four remains unproved, not a correct quiet negative. |

The [real-game engine receipt](quiet-mate-stockfish-18.json) contains 134 fresh
Stockfish 18 depth-16 searches: best/fixed roots, every selected attack and
every terminal mating decision in the six short-mate certificates. All six
distances and all three longer mate-in-four distances agree. These are nine
games, not 134 independent accuracy examples. Colour reflections and all source
prefix lengths are separate regression inputs, not additional real games.

## Contrary controls and secondary themes

The [constructed-control receipt](quiet-mate-controls-stockfish-18.json) adds
69 fresh searches, for 203 fresh searches in this milestone overall. Three
complete certificates cover the rook-interference setup, an added-bishop
variant and a quiet king approach. Four contrary-resource roots remain distinct:

- The queen countercheck draws in this search; missing rook support is near
  equality, not an exact draw proof.
- An exposed king still wins material but lacks the short forced mate.
- The bishop's countercheck delays the quiet setup to mate in five. It is not
  a quiet position or a refutation of the longer attack.
- The added bishop is **not** a sound negative example: it also obstructs its
  own rook. The new root-only mate-in-three certificate is valid. One defence
  uses exf8=N+; Underpromotion belongs at ply 3, not at the root. No new
  interference is asserted for this variant.

An additional 356 eligible quiet source/engine inputs from 246 frozen course
positions and three public cross-phase corpora produce zero new short-mate
certificates. All 246 complete private source/live results, all twenty rare
results and the 32 frozen mistake-priority judgements remain unchanged. This
checks stability across openings, positional play, tactics and endings; it does
not turn existing misses or unchanged classifications into correct answers.

## Verification and remaining limits

- 2,038 selected source/review/render tests, with 84 conditional skips. One
  earlier all-suite run exceeded a five-second aggregate castling-audit test
  allowance. That 18-game multi-input audit now has fifteen seconds; individual
  production scan deadlines are unchanged. Isolated and final-suite checks
  are separate from worker latency evidence.
- 1,316 actual-controller production-worker inputs across sixteen passing
  groups: 808 public timing inputs, twenty additional public rare inputs,
  485 existing private inputs, two private mechanism inputs and one public
  promotion regression. The first expanded run reached all 808 public scans
  but failed an obsolete expected count of 763; all sixteen groups were rerun
  after correcting that test bookkeeping.
- [Public worker receipt](built-worker-adapter104.json): median/p95/max
  65/213/854 ms; maximum computation/transfer 826 ms. These exclude engine,
  network and native UI and are not a speedup claim. Only four of the 763
  prior public headline lists change: the rook-interference and added-bishop
  controls in both colours now lead with the independently proved mate.
  The other 759 prior headline lists remain unchanged, not certified accurate.
- Artifact: `dist/assets/liveTactics.worker-KUGzoKTf.js`, SHA-256
  `9e5329a0d3c8eb11edab34d4feed960e357bc274a9d1d4abf0b1e5d79e20e2fb`.
  Shared-review (41 modules) and app (8,873 modules) builds pass. TypeScript,
  twelve-file scoped lint, three shared-service tests and two cache-recovery
  scenarios pass. Existing bundler size/timing warnings remain.
- 168 actual React/browser-worker groups: eighteen real-game short/full inputs
  and ten constructed inputs, each at 1100/760/360px and 100/200% text. Keyboard
  preview, collapsed details, actual-ply badges, one main label and overflow
  checks pass. Narrow screenshots were inspected. The interference harness
  was corrected to read an uppercase secondary badge and to stop expecting an
  empty result for the independently proved added-bishop mate.
- 81 isolated forced-cold HTTP-worker cases pass. First/next worker startup is
  2,820/68 ms; another startup reaches 3,530 ms. Maximum computation/transfer is
  1,259 ms; separate Vite server startup is 4,005 ms. This is HTTP/Node transport
  evidence, not native WebView reliability or physical-device proof.

Authoritative private replay files are `adapter104-final-sealed-replay.json`,
`rare-theme-adapter104-sealed.json`, `adapter104-quiet-root-sealed.json` and
`adapter104-interference-sealed.json`. Other private receipts are
`adapter104-quiet-mate-certificates.json`, `adapter104-quiet-mate-engine.json`,
`adapter104-quiet-mate-controls.json`, `adapter104-quiet-mate-control-engine.json`,
`built-worker-adapter104-expanded-private.json` and
`adapter104-cold-http-worker.json`. All are under the private benchmark directory,
not Git. Earlier initial/verified diagnostic files are not the final replay.

Browser checks use the actual React result and browser verifier, not native
desktop automation. No owner app, package, engine or service has been restarted
or deployed. Paid course data remains outside Git.

The three new longer mates, older quiet/trap/combination gaps, wider primary
selection and automatic larger-ending causal-review coverage remain open.
The local mate certificate has no full-game repetition history. Passing a
bounded search is not a general position evaluation or a promise to identify
every tactical theme. Cold startup remains variable and is not certified fixed.
