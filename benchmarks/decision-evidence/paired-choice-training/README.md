# Same-board tactical comparisons for classifier training

A near-leading move can be plausible while a specific reply takes away
its value. The experiment asks whether a model can pick which of five
cheap Stockfish candidates should receive an independent search. A
training positive requires a repeated material or short mating consequence
and a separate control after a stronger move on the same board. This
tests the availability of a concrete explanation for an alternative.
Position character, move justification and played mistake remain separate
questions.

## Reference and split

The search collects up to five alternatives from a 90,000-node root
and a 12,000-node reply for each viable choice. Every ranker gets the same
frames. The finite scores must be within 175 centipawns of the preview
leader in the ordinary sample. The network uses the same 17 score and
legal-line measurements as logistic regression and the boosted tree.
Its two hidden layers have 24 and 12 units, with three fixed seeds.

For the reference, Stockfish re-scores those exact choices at a common
MultiPV depth and searches each reply board separately. A tactical
example needs a loss of at least 90 centipawns in both comparisons.
The opponent's first reply and the payoff have to agree across both
searches. The material path follows the original captured piece.
When the same reply is legal after the better choice, a restricted
search must show that the reply retains less material or loses the
forced mate.
The defined close alternatives serve as controls. Other cases stay
unresolved. The detector follows original identities even after an
exchange, en passant or castling. The thresholds and repeat test are in
the [protocol](protocol.json).

The fit uses 280 ordinary public classical games and 230 additional
public games with recorded evaluation drops. The latter give the played
choice a place in the preview. That sampling information stays outside
the model inputs. Each group contributes seven positives. There are
846 close alternatives and 1,197 unresolved choices in the combined
fit inputs. Development separates whole tournament families.

The transfer uses 120 previously unseen games from 16 public 2025
tournament families. It takes one midgame position per game, before
looking at engine evaluations or selected game moves. The sampler
excludes overlaps with earlier named samples and checks the full fit
against the transfer for source families, game prefixes and mirrored root
boards. Of these, 109 boards supply complete frames. The 490 ranked
candidates include four positives across three boards, 236 close controls
and 253 unresolved choices. All 120 positions receive the independent
higher-budget replay. [Frozen boards](holdout.json) ·
[Selection and source hashes](freeze.json) ·
[Public broadcast downloads and time controls](public-sources.json) ·
[Lichess broadcast API](https://lichess.org/api#tag/Broadcasts/operation/broadcastAllRoundsPgn)

## Equal-budget comparison

Every method nominates one alternative per available board. An unresolved
choice uses a slot. The deeper comparison requires the same exact
alternative, stronger move, reply, outcome and original target.

| Ranker | Initial positives | Close controls selected | Unresolved selected | Repeated positives |
| --- | ---: | ---: | ---: | ---: |
| Preview root loss | 0 | 28 | 81 | 0 |
| Short reply loss | 2 | 35 | 72 | 1 |
| Short legal material | 3 | 58 | 48 | 2 |
| Legal-line logistic regression | 1 | 34 | 74 | 1 |
| Legal-line boosted tree | 0 | 36 | 73 | 0 |
| Neural ensemble | 1 | 36 | 72 | 1 |

The short material comparison retrieves both independently repeated
boards, with substantially more close alternatives in its queue. None
of the learned rankers improves both outcomes. Three initial
comparisons, on two boards, retain the exact proof at the higher
budget. The original per-seed iteration limit affected one of the
final network fits. A longer fit finished between 659 and 869
iterations and produced the same holdout selections and average
precision. These small reference counts limit the conclusion to this
search target and sample. The rankers remain research-only.

The 120 initial and stronger captures took 37 and 83 seconds with
seven Stockfish processes on this machine. Candidate prediction adds
no engine queries beyond the common preview. Model evaluation is a
small share of the cost. Verification requires the exact deeper root,
independent replies and, where legal, the challenged reply after the
stronger choice. [Scores, exact lines and repeat checks](results.json)

## Two distinct checking sequences

The committed assessor at `e6fbc1e8` reports both repeated cases as
positional in the cached three-candidate replay. Those strategic
observations have separate evidence from the tactical comparisons.

- **Finnish Championship.** After Qe6 or Qf7, Black plays …Rd1+
  before …gxf4. Taking the bishop immediately lets White play
  Qf5+ and Qxd3. The checking move gets the rook off d3 first.
  After Be3 the bishop is safe from …gxf4 and is supported on e3.
  At the same depth, checking first is better than capturing
  immediately by 558 centipawns after Qe6 and 496 after Qf7.
  The unrestricted three-candidate search includes both alternatives.
  [Round 6 game](https://lichess.org/broadcast/finnish-championship-2025-open/round-6/VbaO6YyH/nG9f6NSy)
- **Asian Zone 3.3.** After Nxd5, …Qxh2+ Kxh2 …hxg5+ wins the
  white queen with a discovered rook check. Immediate …hxg5
  permits Nxc7+ and then Nxa8. Qg7 moves the queen off the target
  square. The matched depth-18 search scores the checking capture
  1,257 centipawns above the immediate pawn capture for Black.
  Nxd5 falls outside both the ordinary three and five unrestricted
  candidates at the same 2.4M-node budget. A wider list alone
  misses it again.
  [Round 6 game](https://lichess.org/broadcast/asian-zone-33-chess-championship-2025-open/round-6/roeA7bS3/2U0pPKIx)

The Mar del Plata comparison appears at the first reference budget and
fails the exact replay at the stronger budget. Keep that case separate
from the verified examples. The new results support testing a checking
move before a capture as a reason to review an alternative. They do
not estimate overall mixed recall.

## Reproduce

Work from the repository root using the retained research directory,
Stockfish 19 matching the hash in the results, python-chess, NumPy and
scikit-learn 1.9.1. Use new output paths for captured frames.

1. The exact public holdout is checked in. To repeat its selection,
   run `broadcasts.py broadcast-rounds.json TRANSFER_CACHE`. Run
   `freeze.py LAB OUT PRIOR_FILES... --transfer TRANSFER_CACHE/sources.json`.
   The eight earlier inputs and their hashes are in [freeze.json](freeze.json).
   Keep the frozen holdout and current capture separate if the upstream broadcasts
   have changed.
2. To reproduce the ordinary fit independently, pass an empty JSON object
   as the transfer manifest and `--test 0`, with the same prior inputs.
   Run `enrich.py TRAIN ENRICHED LAB/neural-search-yield/train-input.json
   LAB/neural-search-yield/reserve-input.json`.
3. Run `search_pairs.py INPUT STOCKFISH OUTPUT` for each fit group
   and for the frozen holdout. Concatenate the two fit JSONL files
   in ordinary-then-enriched order and run `rank.py FIT TEST RANKS`.
   Repeat with `--max-iterations 3200` for the convergence check.
4. Capture the holdout again with `--root-nodes 1900000 --reply-nodes 680000`.
   For the app readback, set `PAIRED_CHOICE_INPUT` to that capture and
   `PAIRED_CHOICE_APP` to a new output file. Run Vitest with this
   directory's `vitest.config.mjs`. The test uses the checked-in assessor
   and three of the comparable search frames. It is a cached replay.
5. Run `review.py TEST STRONGER APP RANKS LONGER_FIT STOCKFISH RESULTS`
   to score repeated witnesses and check the order of the captures.
   Run `test_pairs.py` for the proof, leakage and split regressions.

The sample contains public game positions and derived lines. The raw
broadcast exports and generated search frames remain in the local research
directory.
