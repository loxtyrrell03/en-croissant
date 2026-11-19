# Original and rebuilt decision classifiers on matching evidence

This audit compares the original live tactical scan and mistake
classifier with decision assessment v33. Every comparison uses the
same saved Stockfish frames and reference labels. The 124-case
freeze was held out for v13 and later used in development. The
archived classical positions and errors also informed earlier work.
These numbers describe a retrospective comparison. The separate
quiet-threat reserve tests the later targeted change prospectively.

| Reviewed scope and axis | Positives / negatives | Original true / false positives | v33 true / false positives |
| --- | ---: | ---: | ---: |
| Ordinary classical position, tactical | 135 / 54 | 31 / 0 | 40 / 0 |
| Ordinary classical position, positional | 212 / 27 | — | 64 / 1 |
| Ordinary classical position, mixed | 88 / 81 | — | 8 / 1 |
| Other reviewed position, tactical | 183 / 51 | 22 / 0 | 40 / 0 |
| Classical mistake, tactical | 68 / 165 | 10 / 1 | 19 / 0 |
| Classical mistake, positional | 89 / 164 | 2 / 0 | 20 / 0 |
| Classical mistake, mixed | 17 / 185 | — | 1 / 0 |
| Woodpecker move justification, tactical | 35 / 9 | 7 / 1 | 19 / 1 |
| Woodpecker move justification, mixed | 9 / 22 | — | 2 / 2 |
| Independent puzzle move justification, tactical | 47 / 0 | 27 / 0 | 26 / 0 |

The original tactical position column uses the exact first move's
live motif as a proxy. An alternative proxy that counts any motif
in the leading lines yields 36 true positives in ordinary positions
and 31 in other reviewed positions, both with zero false positives.
The original system had no independent positional or mixed
classification for positions or candidate moves. The underlying
questions about a mistake's motive and a root move's motif have
different denominators.

The independent puzzle group has no reviewed tactical negatives.
Pooled position cohorts include material enriched for particular
mechanisms and are presented separately. Unknown axes and unreviewed
motifs stay outside the scored denominator. False negatives include
abstentions on reviewed positives. Most reference labels have one
reviewer. This audit measures algorithm agreement with those labels.
The intervals in the results treat decisions as individual observations
and do not adjust for correlations between games or events.

## Named motifs and speed

The independent engine-line replay covers 44 puzzle moves and 34
Woodpecker moves. A separate 40-case fork audit uses exact move
labels. The original and current **live root motif** sets agree on
all of those cases. The named fork verifier detects 9 of 14 positives
in its audit with zero false positives among 23 reviewed negatives.
It misses all four reviewed deflections in the two engine-line groups
and both reviewed Woodpecker clearances. These counts cannot measure
unrepresented motifs such as overloading. The table above also
includes evidence from the rebuilt decision layer, so its results
can differ from the live root motif results.

Median classifier time on the ordinary archived positions was about
26 ms for the original scan and 46 ms for the full v32 worker.
For the archived mistakes, median time was about 5 ms for the
original mistake classifier and 75 ms for the full worker, which
also assesses the position and candidate moves. These are matched
cached inputs and timings exclude search and rendering. The source
worker only runs new quiet-threat checks on evidence already collected.

The ordinary-position replay found a Montenegro case where the
original showed a concrete quiet mate threat and v32's position
report was unclear. The [quiet-threat experiment](../quiet-mate-threats/README.md)
reproduces the missed evidence and tests the v33 correction on a
separate reserve. Positional and mixed recall, and named modes of
deflection and clearance, remain the largest verified gaps.

## Reproduction and private inputs

- [Results](results.json) records hashes, denominators, precision,
  recall, reference agreement and intervals. The original source
  hash list includes the earlier uncommitted checking-ray patch.
  Run `restore-original.py` with a new output directory and the
  original private classifier research folder. It restores and
  checks the baseline without editing the application checkout.
- For the archived replay, set `DECISION_SCORE_INPUT` to the
  saved `reply-coverage-audit/full-pair-input.json` in the private
  classifier research folder and `DECISION_SCORE_OUTPUT` to a fresh
  path there. Set `DECISION_SCORE_ARM=original` and
  `DECISION_BASELINE_CAUSAL` to the restored causal source for
  the original arm. Use `DECISION_SCORE_ARM=current` for v32.
  Run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/cross-scope-audit/archive.config.mjs archive.bench.ts`.
- The same configuration runs `decisionMotifTransferReplay.test.ts`
  for the two live-motif arms. Set its private input to
  `neural-motif-transfer/transfer-audit.json` and give it a fresh
  output path. Use the [v33 worker replay](../quiet-mate-threats/README.md)
  with that archive's matched engine frames for the latest counts.
- For the 124 earlier reviewed cases, use the existing
  `decisionCandidateAudit.test.ts` with `reviewed-validation`,
  the original v13 freeze, saved v13 reports and exact engine caches.
  The [original protocol](../../../docs/CHESS_DECISION_CLASSIFIER_REBUILD.md#frozen-candidate-evaluation)
  documents the inputs. Keep course positions, annotations and private
  games under the task workspace.
- `aggregate.py` takes the original research folder, the replay output
  directory and a new output file. It checks root and probe identities
  and uses the existing scorer on the saved reference labels.
