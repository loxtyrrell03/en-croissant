# Distinguishing forks and measuring the remaining mixed-decision gap

In Decision Evidence, the mistake comparison used to equate two motifs
of the same type whenever they shared any square. Two checking forks
almost always share the king square. That was enough to suppress a genuine
distinction even when the forker attacked a different second piece.

The new comparison uses the forking square and the unordered pair of
target squares. The mistake report can now describe both forks when the
stronger line has a supported material advantage. A second prototype
traced the original pieces through each legal continuation, including
captures, en passant, castling and promotions. It changed the same
reports as the simpler comparison. The integrated change uses the
simpler fork comparison and the existing engine frames.

## Actual decisions affected

The 740-request replay contains 318 archived classical mistakes, 254
separate classical decisions, 68 comparisons using different depth
budgets, 52 Woodpecker exercises and 48 independent puzzle moves.
The 254 decisions exclude known shared games and colour-normalised root
boards from the archive. They are drawn from existing benchmark evidence,
with a mix of ordinary and targeted cases. These are retrospective replay
and transfer counts. This comparison does not use unseen expert labels
for every decision in the reserve.

| Product replay | Same-type comparisons made by baseline | Reports changed by role-aware matching | Reports changed by tracking original pieces |
| --- | ---: | ---: | ---: |
| 318 archived mistakes | 7 across 3 cases | 0 | 0 |
| 254 separate classical requests | 5 across 3 cases | 2 | 2 |
| 68 depth-comparison arms and 100 exercise requests | 6 across 4 cases | 0 | 0 |

Both changes were reviewed with the exact continuations.

- **Sparkassen Open.** `Ne7+ Kg7 Nxf5+` and the played
  `Nf6+ Kg7 Nxh5+` both fork the king, with different second targets.
  The stronger continuation uses `Rxf8 Kxf5 Rxf7+`. In the played
  continuation, forcing `Rxf8` allows `Kxh5` and the following
  `Rxf7` gives no check. A separate 4.8M-node paired root search scores
  the moves at −13 and −333 centipawns at depth 24. Checking the two
  reached positions independently corroborates the bishop capture as
  a resource in the stronger line. The mistake goes from unclear to
  tactical and shows both fork targets.
- **Cork Congress.** After `Qxb2`, Black can play `Qxe4+`, forking the
  king on g2 and rook on a8. The separate line after `Qf3` reaches
  `Qh1+ Kg4 Qxe4+` much later, with no fork on the original rook.
  The old comparison matched the shared e4 square. The new report
  preserves the specific allowed fork alongside the existing tactical
  diagnosis. [Cork Congress round 1](https://lichess.org/broadcast/cork-congress-2026-masters-1825/round-1/6jT7GvmT)

The new fork comparison changes no positional or mixed verdict on the
replayed decisions. It keeps the fork and outcome separate. The proof of
the difference in the Sparkassen case is available in the independent
checkpoint lines. The app does zero additional searches. Cached-engine worker
replays in the run had medians around 81 ms in the archived mistakes and
89 ms in transfer, including assessment of the position and candidate
moves. Small differences across arms are within run-to-run variation.

## Current performance across the three questions

The table matches the saved original, v33 and v39 reports on exact
Stockfish evidence. For the courses and independent exercises, the
scorer compares the root frame, probe contents and all exact move
identities against the stored evaluation inputs. These were originally
held out for earlier development and have since been used in research.
Statistical intervals and per-motif results are available in
the [full audit](results.json). A dash indicates the original classifier
lacked that comparable axis.

| Reviewed axis | Positives / negatives | Original true / false positives | v33 true / false positives | v39 true / false positives |
| --- | ---: | ---: | ---: | ---: |
| Ordinary classical position, tactical | 135 / 54 | 31 / 0 | 40 / 0 | 40 / 0 |
| Ordinary classical position, positional | 212 / 27 | — | 64 / 1 | 64 / 1 |
| Ordinary classical position, mixed | 88 / 81 | — | 8 / 1 | 8 / 1 |
| Other reviewed position, tactical | 183 / 51 | 22 / 0 | 40 / 0 | 38 / 0 |
| Classical mistake, tactical | 68 / 165 | 10 / 1 | 19 / 0 | 20 / 0 |
| Classical mistake, positional | 89 / 164 | 2 / 0 | 20 / 0 | 20 / 0 |
| Classical mistake, mixed | 17 / 185 | — | 1 / 0 | 1 / 0 |
| Woodpecker move justification, tactical | 35 / 9 | 7 / 1 | 19 / 1 | 19 / 1 |
| Woodpecker move justification, mixed | 9 / 22 | — | 2 / 2 | 2 / 2 |
| Independent puzzle move justification, tactical | 47 / 0 | 27 / 0 | 26 / 0 | 26 / 0 |

Three formerly credited detections in the other-position group used
discovered-attack explanations that no longer meet the original-target
requirement. One Prague position gains a discovery against an original
pawn. The broader tactical position reference labels are kept as reviewed.
The score counts the former three as lost detections on that reference,
even though the particular motif proofs were invalid. This distinction
matters when tracking recall or teaching a model from the labels.

### Did the mixed mistakes need a deeper search?

Eight of the 17 historical mixed mistakes remained mixed under the
independent review. The depth comparison uses those eight as the
denominator and replays the four search combinations on the same
exact moves. The separately searched branches meet the application's
corroboration check in six of eight original frames. The deeper root
pair and separate replies together supply both usable frames for all
eight.

| Evidence for eight rechecked mixed mistakes | Mixed | Tactical only | Positional only | Unclear | No assessment |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original root and replies | 1 | 1 | 1 | 4 | 1 |
| Deeper matched root pair | 0 | 1 | 1 | 6 | 0 |
| Deeper separate replies | 1 | 1 | 2 | 3 | 1 |
| Deeper root and replies | 0 | 1 | 2 | 5 | 0 |

Replacing the search frames restores one missing comparison and changes
the measured loss in several cases. The new frames supply no additional
mixed verdict. In the en-passant case the deeper estimated loss is below
the original gate for the tactical label. The King–rook example from
the Asian Disabilities Championship still lacks an explanation linking
repeated rook checks to the changed treatment of the original passed
pawn. Distinct, demonstrable mechanisms remain necessary even with
stronger engine frames.

## Reproduce

1. Run `inputs.py RESEARCH_ROOT OUTPUT_DIR` with Python 3.13 and
   python-chess. This reuses the retained engine comparisons and preserves
   private games and courses outside Git. Source hashes and quotas appear
   in [inputs.json](inputs.json).
2. From the repository root, set `IDENTITY_INPUT` to the combined input
   and `IDENTITY_OUTPUT` to a fresh path. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/compared-motif-identity/vite.config.mjs`
   with `IDENTITY_ARM` set to `record`, `squares`, `origins` or
   `release`. The comparison arms pin v39 and the release arm reads the
   selected source revision. The mistake paths are replayed through the
   actual worker.
3. Run `audit.py RESEARCH_ROOT OUTPUT_DIR AUDIT_JSON`, with the reports
   named `combined-record.json`, `combined-squares.json`,
   `combined-origins.json` and optionally `combined-release.json`.
4. Run `checkpoints.py STOCKFISH checkpoint-input.json OUTPUT --nodes 4800000`
   for the Sparkassen checks. The [published receipt](checkpoints.json)
   records the exact engine and completed lines.
5. Run `comparedForkTargets.test.ts` and
   `verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE`. The actual move
   analysis and expanded evidence interaction were checked at 320, 390 and
   900 pixels with cached engine inputs in a source-built browser.
   Installed-app verification is pending.

[Public frames](fixtures.json) · [Exact search receipt](checkpoints.json) · [Scored audit](results.json)
