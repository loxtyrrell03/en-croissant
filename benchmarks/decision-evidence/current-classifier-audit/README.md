# Current classifier accuracy across separate questions

This replay compares the original scanner and mistake classifier with
Decision Evidence at `ae4bf1fc`. It uses the same legal Stockfish frames for
both. The three labels describe position character, the exact candidate
move and the actual mistake. Tactical and positional support are independent.
Abstentions on a reviewed positive count as misses. An uncertain reference
is outside that axis's denominator.

## Retrospective benchmark

The archive contains 1,051 requests. Its labels and the early 124-case
cohort were used in earlier evaluations and development. The latter
includes 52 course, 48 independent puzzle and 24 owner-classical frames.
The 52 course frames carry 65 separately reviewed position or move
questions. Paid positions, course annotations and owner games stay in the
local research directory. This is a matched retrospective update.

| Scope and axis | Original true / false positives | Earlier v33 true / false positives | Current true / false positives | Reference positives / negatives |
| --- | ---: | ---: | ---: | ---: |
| Ordinary classical position, tactical | 31 / 0 | 40 / 0 | 40 / 0 | 135 / 54 |
| Ordinary classical position, positional | — | 64 / 1 | 64 / 1 | 212 / 27 |
| Ordinary classical position, mixed | — | 8 / 1 | 8 / 1 | 88 / 81 |
| Other reviewed position, tactical | 22 / 0 | 40 / 0 | 38 / 0 | 183 / 51 |
| Other reviewed position, mixed | — | 3 / 0 | 2 / 0 | 139 / 70 |
| Classical mistake, tactical | 10 / 1 | 19 / 0 | 22 / 0 | 68 / 165 |
| Classical mistake, positional | 2 / 0 | 20 / 0 | 20 / 0 | 89 / 164 |
| Classical mistake, mixed | — | 1 / 0 | 1 / 0 | 17 / 185 |
| Woodpecker exact move, tactical | 7 / 1 | 19 / 1 | 20 / 1 | 35 / 9 |
| Woodpecker exact move, positional | — | — | 6 / 3 | 24 / 13 |
| Woodpecker exact move, mixed | — | 2 / 2 | 2 / 2 | 9 / 22 |
| Independent puzzle exact move, tactical | 27 / 0 | 26 / 0 | 27 / 0 | 47 / 0 |

The original tactical position measure is a proxy based on the scanner's
exact leading-move motif. The original had no independent positional or
mixed position or move assessment. The true-positive scores for other
reviewed tactical positions decline from v33. Three disappeared
explanations called materially incomplete rook or pawn sequences
discovered attacks. One other case was added.

The current assessor sees neither dimension on **57 of 88** reviewed
ordinary mixed positions and **10 of 17** mixed mistakes. It sees only
one dimension on 23 positions and six mistakes. Missing mixed reports
therefore often involve missing evidence on both sides. A looser rule
for combining the two axes would address only a minority of the misses.

The exact-move scorer tests only named motifs that were reviewed in each
frame. Independent puzzle fork detections rise from four to five of seven,
with zero false calls among 25 reported fork negatives. Named deflections
go from zero to two of three in the independent group. The two reviewed
course clearances still remain undetected in these exact frames. Complete
per-motif precision, recall, false positives, false negatives and
unreviewed denominators are in [results.json](results.json).
The case-level intervals do not adjust for source correlations.

Median worker compute was about 46 ms for ordinary positions and 81 ms
for played-mistake reports. The original's narrower scan and mistake
categorization took about 26 ms and 5 ms respectively in separate runs.
These are cached-frame measurements and exclude Stockfish and rendering.

## Prospective classical check

We froze one position from each of 26 games, excluding matching known
game prefixes and color-normalized boards. Twenty-four are public
classical games across six events, and two are from the owner's recent
classical games. There are 17 ordinary cases and nine cases sampled for
a broadcaster or saved analysis drop. One reviewer saw shallow and
deeper legal continuations and saved separate axis labels before opening
either replay. The known labels are small and predominantly positive.
The game and board splits are independent of the listed exclusions.
This does not make the sample an estimate of real-world precision.

The original and current build each detect 2 of 7 reviewed tactical
positions. The current build detects 2 of 14 positional positions.
The one reviewed mixed position remains unclear on both dimensions.
For mistakes the original detects 0 of 2 reviewed tactical causes and
the current build 1 of 2. Both flag the single reviewed tactical
negative. The current build detects 0 of 3 reviewed positional
mistakes. No mistake had a confirmed mixed reference in this cohort.

Three exact gaps guide further work.

- **Witney.** Qh8+ and Qf6 bring about a queen exchange, leaving a
  passed pawn on f6. The close Rbc1 alternative attacks the same
  problem through c-file activity. The report misses both the tactical
  route to the trade and the durable passer.
- **European Club Cup.** Ne5 Bxe5 fxe5 changes the pawn structure. Both
  current and original mistake classifications call it tactical. The
  current reason cites a pawn gain after the alternate Nxe5. The two
  Stockfish searches of that reply both play fxe5 and show a materially
  even exchange through the explanation window. This is a specific
  conflict between the local tactical claim and the searched lines.
- **Owner-classical.** Two independently compared moves leave clear
  strategic differences after rook activity or changes to king shelter.
  Both mistake diagnoses stay unclear. The detailed games and notes
  are retained locally.

## Reproduce

Use the local data and exclusion paths listed in the existing [archive
audit](../cross-scope-audit/README.md). Run `prepare.py early LAB OUTPUT`
to reassemble the 124 exact frames. It checks the original source
manifest, engine/probe identities and per-frame parent hash. The archive
input is `reply-coverage-audit/full-pair-input.json`.

Set `INTERFERENCE_MODE=archive`, `INTERFERENCE_REVISION=ae4bf1fc`,
`INTERFERENCE_INPUT` and `INTERFERENCE_OUTPUT`. Run the existing
[worker replay](../interference-in-line/README.md) for the archive,
the 124 frames and the prospective scored inputs. Use the names
`archive-v47.json`, `early-v47.json` and `prospective-v47.json`.

`freeze.py` reconstructs the prospective sample. Use the source files
in the manifest, in order, with `--prior` pointing to the retained
1,875-request archive, the 124 frames, the draw-aware held-out selection
and both competing-pawn-plan reserves. For the personal data pass
the two original local PGNs with `--owner`. The reviewer used Stockfish
19 with 2.4M and 4.2M nodes for the root and matched comparisons, and
1.4M and 2.8M for reached replies. Use the same
[search runner](../draw-aware-search/README.md) with those budgets.

Run `prepare.py legacy SCORED OUTPUT` and use the restored original
in the existing archive runner for `prospective-original.json`.
[Public reference](prospective-reference-public.json) contains the public
portion of the review. Reproducing the full score needs the hashed local
reference, public and private. Run `score.py LAB REPLAY_DIRECTORY OUTPUT`.

## v57 archive refresh

The committed worker at `27580772` was run on all three saved cohorts
using the previous engine frames and labels. Run the same replay with
`replay.config.mjs` and `INTERFERENCE_MODE=archive` to pin this
worker's source even from a checkout with pending changes. Set
`INTERFERENCE_INPUT` and `INTERFERENCE_OUTPUT` for each of the three
inputs. Name the new files `archive-v57.json`, `early-v57.json` and
`prospective-v57.json`. Run `score.py LAB REPLAY_DIRECTORY OUTPUT
--tag v57 --revision 27580772 --references EARLIER_AUDIT_DIRECTORY`.

| Scope | v47 true / false positives | v57 true / false positives | Reference positives / negatives |
| --- | ---: | ---: | ---: |
| Ordinary classical position, tactical | 40 / 0 | 40 / 0 | 135 / 54 |
| Ordinary classical position, positional | 64 / 1 | 64 / 0 | 212 / 27 |
| Ordinary classical position, mixed | 8 / 1 | 8 / 0 | 88 / 81 |
| Classical mistake, tactical | 22 / 0 | 22 / 0 | 68 / 165 |
| Classical mistake, positional | 20 / 0 | 20 / 0 | 89 / 164 |
| Classical mistake, mixed | 1 / 0 | 1 / 0 | 17 / 185 |
| Woodpecker exact move, tactical | 20 / 1 | 20 / 1 | 35 / 9 |
| Woodpecker exact move, positional | 6 / 3 | 6 / 1 | 24 / 13 |
| Woodpecker exact move, mixed | 2 / 2 | 2 / 0 | 9 / 22 |
| Earlier prospective played mistake, tactical | 1 / 1 | 1 / 0 | 2 / 1 |

Recall is unchanged on these saved frames. Of the 88 reviewed mixed
ordinary positions, 57 still have support for neither axis. The course
and independent-puzzle exact-move motif counts are unchanged from the
v47 replay. Current median worker compute on the archive
was 47 ms for ordinary positions and 77 ms for recorded mistakes,
excluding engine work. New optional app searches are outside the scope
of this cache replay.
[Full counts, motif results and uncertainty](results-v57.json)

## New prospective sample

`classical-2026-11.json` freezes 72 distinct public classical games
from 15 event groups before either classifier was run. Every combination
of the three recorded mover-rating bands and three move-number windows
has eight games. The time-control evidence, export URLs, prior input
hashes and inclusion counts are in `classical-2026-11.manifest.json`.
The game and board exclusions include the older mixed and course
audits and the recent neural and checking-order cohorts. The reference
is pending review. The archive scores above are separate.

To regenerate, download only the PGN URLs listed in the manifest into
a scratch directory under their listed filenames. Use its
`broadcasts` array as the input source list when replaying the frozen
selection and supply the same prior files in the manifest. Run
`freeze-classical.py SOURCES OUTPUT --prior PRIOR_FILES...`. The
app-budget and deeper frames use `classical-frames.py app INPUT
STOCKFISH OUTPUT` and `classical-frames.py reference INPUT STOCKFISH
OUTPUT --app-frames APP_OUTPUT` from the repository root. Review the
matched frames with `classical-review-packet.py APP_OUTPUT REFERENCE_OUTPUT`
under the [frozen reference protocol](classical-review-protocol.md).
