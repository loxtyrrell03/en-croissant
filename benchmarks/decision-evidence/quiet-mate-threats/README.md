# Quiet moves that require a defence to mate

The earlier tactical overlay already annotated the threat created by
`...Qh4` in the Montenegro Cup. The decision classifier deliberately
excluded parryable threats from mistake certificates. That filter also
kept a useful observation out of position character and move
justification, where the obligation to calculate the defence matters.

The updated proof verifies a new mate threat, explores legal replies
within the existing local proof budget, and checks that the defences
shown by both Stockfish searches actually stop all immediate mates.
For `...Qh4`, `Re1` stops the immediate mate and `Rc3` allows
`...Qh2#`. The two searches may show different valid defences.
The report prefers a searched losing reply and can use a separately
checked legal example when the engine only lists defences.
The rule applies to position character and candidate move justification.
Mistake attribution still requires evidence about the player's move.

## Before and after

| Sample | Candidate boards with new tactical support | Quiet controls changed |
| --- | ---: | ---: |
| Development, Grand Swiss and British Championship | 11 of 18 | 0 of 20 |
| Separate World Senior Championship round, after freezing the rule | 9 of 15 | 0 of 10 |
| Archived evaluation | 1 of 1,050 valid boards | 2 further reports gain move evidence only |

One additional development position already had tactical support and
gained a concrete quiet-move explanation. The strict experimental arm
required the engine to have searched an ignored threat itself. It
recovered the Montenegro regression and added zero position diagnoses
among the 38 development games. The legal-example arm recovered the
same regression and supplied the wider coverage above.

The 15 reserve threat boards were selected by replaying recorded
quiet moves and exactly checking for a new threat and an available
defence before engine analysis. They contain one board per game.
The 10 controls are ordinary quiet moves from other games in that
round. This is an enriched benchmark of the named mechanism, with
no estimate of its incidence across all games. Python-chess replay
independently checks every added defence and mating line. Four of
the reserve positions already supported the positional axis. The
new tactical evidence changes their display to mixed. Its addition
does not independently adjudicate the earlier positional factors.
[Grand Swiss](https://lichess.org/broadcast/fide-grand-swiss-2025-open/round-1/xSCoiNg0) |
[British Championship](https://lichess.org/broadcast/2025-british-chess-championships-championship/round-1/Rus7vgww) |
[World Senior Championship](https://lichess.org/broadcast/fide-world-senior-championship-2025-open-65/round-1/Cb9z7AQN)

The engine search budget is unchanged. One paired development and
archive replay took 131.3 seconds for the previous worker and 132.1
seconds for the new worker across 1,089 inputs, excluding Stockfish.
Every played-move diagnosis and status matches across the development,
reserve and archive replays. The source-built panel shows both lines
for the Montenegro case and a mixed Grand Swiss position.
[Counts](results.json) and [concrete cases](witnesses.json)

## Reproduction

- [Protocol](protocol.json) records the sources and the rule hashes
  frozen before the reserve. `collect.py` samples complete classical
  rounds using chess legality and reruns the existing Stockfish
  search. The arguments are a new output directory, the PGN paths,
  `--engine`, and `--exclude` with the earlier JSON case inputs.
- Set `THREAT_OUTPUT` to a new path and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/quiet-mate-threats/vitest.config.mjs`.
  Set `THREAT_REVISION=8ff28909` for the previous worker. The default is
  the committed worker. The runner uses the saved public [development](development.json)
  and [reserve](reserve.json) frames. `THREAT_INPUT` overrides them
  for a private archive.
- Run `verify.py BASELINE_REPORT CANDIDATE_REPORT` with the matching
  worker outputs. It checks each added SAN explanation's underlying
  lines using python-chess. Supply the same optional input file as
  the third argument to reproduce a private replay.
