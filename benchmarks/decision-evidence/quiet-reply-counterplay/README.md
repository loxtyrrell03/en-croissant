# Quiet defensive replies that permit a tactic

The previous conditional verifier looked at captures of the piece
that had just moved. It had no path for a quiet reply that blocks
the attack or adds a defender while threatening that piece. The
new verifier follows a larger piece newly attacked by the root.
It checks legal recaptures and the attacked piece's original identity.
A superficially plausible reply must score worse than the strongest
reply in a matched search.

For an interposition, a second search must confirm a checking route
made possible by the reply vacating a square. The best response
outside that route must score meaningfully worse. In a defended
target case, both searches must take the original target and
retain a net material gain across the shown exchange. Different
sound capture orders can meet that requirement. The explanation
stays conditional on the exact reply. It can add tactical support
to the candidate and position character without changing existing
positional support or the actual mistake.

## Matched result

The held-out selection uses 106 public classical games across 18
tournament groups. The 58 enriched games contain a recorded quiet
defence with the required legal relationship. The other 48 supply
one ordinary position per game. Selection predates the Stockfish
replay and excludes the identified groups, game histories and
mirrored boards of earlier cohorts. The tests use public
[Lichess tournament exports](https://lichess.org/broadcast/help).

| Experiment | Extra queries | Independently reproduced explanations |
| --- | ---: | ---: |
| v57 worker on the common frames | 0 | No matching conditional explanations |
| Verify a suitable reply already in the top three | 0 | 0 |
| Target one plausible reply, then verify the answer | 12 | 3 |

The exact recorded-response reference contains one positive, 47
replies that remain competitive at the set cutoff, six roots
outside the competitive band, and four unresolved comparisons.
The targeted run finds that one positive. Two additional
nominations explain different replies from the game's recorded
move. Separate deeper searches corroborate those exact
alternatives. The new worker publishes two explanations and
keeps a pre-existing tactical explanation in the third case.
The sample supports a narrow transfer claim. The small positive
count and the automatic label protocol limit precision and recall
inference. The ordinary cases measure triggered searches.
[Counts, costs and legal lines](results.json)

- **Asian championship.** h3 attacks the g4 knight. Qg3 adds
  a defender and attacks h3. hxg4 still wins the original
  knight with a retained gain. v57 reported the position and
  candidate as unclear. Both become tactical.
  [Game](https://lichess.org/broadcast/4th-asian-chess-championship-for-players-with-disabilities-2026-men-juniors/round-5/4aLETl6X/6TpESJyq)
- **Danish league.** …b4 has existing positional support. Qa4
  covers a3 and attacks the pawn, but …bxa3 still wins the
  knight. The near-leading …b4 candidate and position become
  mixed. The leading …a6 candidate keeps its own assessment.
  [Game](https://lichess.org/broadcast/skakligaen-20262027/round-1/mqrJwMy3/HIJTOOmv)
- **Development interposition.** Bg5 attacks the e7 rook.
  …f6 interposes and attacks the bishop, but vacates the path
  for Bg8+. At 1.4M nodes the extra search rates the checking
  response only 25 centipawns above Bf4 and the verifier
  abstains. The independent development run at 3.2M nodes
  corroborates the opened route. This example remains
  sensitive to the normal search budget.

The optional step uses at most two 1.4M-node searches in a shared
4.8-second window within the current analysis session. It reuses
usable cached replies and examines viable moves with no existing
tactical proof and a searched reply frame. The enriched replay
uses 16.8 million requested extra nodes in total. The 48 ordinary
positions trigger no extra searches. The scoped worker replay
changes two of 106 reports and no played-mistake assessments.

## Reproduction

Use the frozen `holdout.json` and the source and input hashes
in `holdout.manifest.json`. `freeze_sample.py` can regenerate
the selection from those exports and exclusion arrays in the
same order. Run `quiet_trials.py ref SAMPLE ENGINE holdout-reference.json`
and `quiet_trials.py app SAMPLE ENGINE holdout-trials.json` from
the repository root with the specified Stockfish 19 build.
Run `worker_inputs.py holdout-trials.json OUTPUT_DIRECTORY`,
then rerun reference mode with `confirmed-questions.json`
to check the exact alternate replies.

Replay `common-worker-input.json` against revision
`27580772` using the
[shared replay config](../current-classifier-audit/replay.config.mjs)
in archive mode. Replay `release-input.json` with the adjacent
Vitest config and the v58 revision. Use the result filenames in
`summarize.py` to reproduce `results.json`. Run the same
Vitest config with `QUIET_REPLY_ENGINE` set to Stockfish to
exercise the actual engine boundary. The browser fixture checks
both evidence expansion and changing the selected candidate.
