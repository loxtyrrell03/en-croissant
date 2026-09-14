# Mistake nature v4: causes, not line-shape guesses

## Scope and result

The desktop mistake-type classifier now shares the motif classifier's independently
checked root evidence. It no longer has a separate 800-line collection of SAN,
attack-count and PV-material heuristics that can contradict the displayed lesson.
The motif proof algorithm remains **adapter 106 / live pipeline 111**.

- An opponent tactic requires an independently established **prevented/reduced**
  comparison before it explains the mistake. Existing or un-compared danger does not.
- A missed opportunity must be an immediate, sufficiently supported root lesson.
  Comparable captures and conditional later motifs cannot supply that accusation.
- Legal best/played roots must differ. A supplied loss of at most 20 cp does not
  establish a meaningful mistake; the threshold is not proof of equivalent play.
- Exact winning/drawing zugzwangs retain their zero-material WDL lessons. A zero
  material bound must not discard an important endgame resource.
- Missing or inconclusive evidence is **Unclassified**, not a claimed positional
  negative. Quiet, legal, sufficiently deep continuations can support **Likely
  positional**, explicitly a medium-confidence estimate, not tactical completeness.

This is cause reconciliation and honest abstention, **not a claim of general
accuracy or complete tactical coverage**. A direct root proof can still omit the
most instructive mechanism, and bounded proofs do not settle all longer attacks.

## Fresh games and independent review

`nature-context-development.json` fixes 24 boards at plies 8, 21, 40, 59, 80 and 99
from five additional public game histories. Six unavailable plies are recorded,
not replaced. Both colours, openings, middlegames, queen endings and rook endings
are included without evaluation-loss filtering. Initial board-based judgements
were written before fresh engine/nature outputs in
`nature-context-initial-judgement.md`.

The source puzzle endpoints had been examined before; these contexts are not a
representative holdout of all chess. Twenty-one earlier fixed game contexts are
also replayed without changing their inputs. There are **72 fresh Stockfish 18
searches** for the 24 new boards: best move, actual move held fixed and its actual
reply position. The 63 searches behind the earlier 21 boards are reused, not fresh.

The old classifier marked **39/45** boards tactical. The new classifier marks one
tactical and leaves 44 unclassified. That is **not 44 correct negatives**: several
attacking/exchange positions remain unresolved, and many actual moves are not
mistakes. The important removed claims include:

| Position | Old claim | Chess/evidence review |
| --- | --- | --- |
| yOwOb8mH, ply 8 | Best Qe2 prevents the queen attack after d4 | An ordinary developing tempo against the queen, with only an 8 cp held-move difference, is not an established tactical mistake. |
| yOwOb8mH, ply 40 | Nf4 prevents the opponent's pawn threat | Nf4 was the actual move **and** the supplied best move. |
| BkwHTU3l, ply 21 | Missed Qxf6 wins a knight | Qxf6 was the actual check-evasion recapture, not a missed capture. |
| ZFgq8VzD, ply 60 | Kf5 prevents Ng6's mating threat | Kf5 was played; the independently checked threat **persists**. It remains a position lesson, not a caused mistake. |
| C9q6jvtW, ply 41 | A later rook fork / four-point PV gain explains fxg4 | Rxc6 and fxg4 have comparable immediate captures. The capture difference alone is not an established cause. |
| BkwHTU3l, ply 59 | Missed a later Rxa7 queen capture | Retains the independently proved **Rxd7+** root capture instead. |

The final example is **not certified to have the ideal primary theme**: Rxd7+
vacates the c2–e4 checking diagonal, so a discovered-check explanation may be more
instructive than its current generic capture label. This remains a concrete
primary-mechanism follow-up. Sharp 8OYE3aem ply 40, eTscGjLx ply 40 and BkwHTU3l
ply 40 are explicitly unresolved, not called positional successes.

`mistake-nature-v4-review.json` records all 45 before/after classifications and
32 reused frozen causal lessons. All 30 established tactical causes keep the same
primary explanation; two existing-danger controls abstain. Existing source/live
motif outputs are unchanged. Separate regressions retain real forced interference,
quiet mating attacks, subsequent self-interference/deflection and exact winning
and drawing zugzwangs.

## Skeptical review of old positive tests

Eight additional fresh depth-16 searches examine two constructed old nature-test
claims (`nature-countercheck-stockfish-18.json`).

- The apparent Ne5 fork of Qd7/Rf7 permits **Qd4+**, followed by Qxe5 after a king
  move. Stockfish also finds forced mate for Black. Both the best and held Ne5
  searches are losing; this is not evidence that Ne5 caused the whole loss.
- Qh5 threatens mate, but **g6** answers it. White remains winning: held Qh5 is
  +428 cp versus the best search's +634 cp, and the separate defensive searches
  vary. These estimates do not prove a forcing root mate/material mechanism or
  make the position a correct negative.

The ordinary tests now reject notation-only “proof,” rather than preserving those
incorrect positive expectations. Genuine quiet mating and interference controls
prevent an indiscriminate suppress-everything fix.

## Delivery and verification

- Nature metadata version **4** migrates old saved cards through existing idle
  maintenance, with a yield every two changed cards. Schema, counts, filters,
  evidence text and both desktop stored-label readers accept `unknown`.
- The main nature explanation and at most one secondary lesson use the same
  root-priority selector as the motif explanation. Timelines are not flattened
  into additional root accusations. Proof/migration cost is not engine latency.
- **2,178 selected tests pass, 89 optional skips**; 97 final focused nature,
  migration and game-context tests pass. The retained v3 source fails 16 of the
  17 new game-context regression groups; this is a regression receipt, not an
  accuracy score.
- All **246 private source/live full results**, twenty rare-theme full results
  and the 32 frozen motif priorities are unchanged from adapter 106. Unchanged
  output is not independently certified accuracy; paid material remains private.
- **36 actual React/Chrome renderer groups** cover 1100/760/360 px, 100/200% text,
  tactical/unclassified/likely-positional labels, reveal/details/timelines and
  JSON-schema reload plus v3-to-v4 migration. They exposed clipping of the new
  status and an existing missed-fork badge; wrapping/header stacking were fixed.
  This is isolated browser evidence, not a native-owner-session check.
- Whole-project TypeScript, scoped lint, shared-review build, app build and four
  service/two development-cache checks pass. Existing large-bundle warnings remain.
  The shared service changes only an internal helper name; its behavior is unchanged.
- The live tactics worker is byte-identical to the verified adapter-106 artifact:
  `liveTactics.worker-xovwLfyQ.js`, SHA-256
  `39642227b18e76f567d042e7495b3a08c01b1c6b41246db1a82200276a187710`.
  The previous 1,407 worker inputs and 81 cold HTTP checks were **not rerun** in
  this nature-only milestone; no new timeout/reliability claim is made.

No owner app/service/package restart, installation, deployment or private-data
modification. Broader root-mechanism coverage, connected capture-choice causation,
longer king hunts, nature coverage and native runtime verification remain open.
