# Verified defence against mate in one

An engine shortlist can contain several moves that all stop the same
threat. The old position and move assessments had no opponent checkmate
to replay in those lines, so they could miss why a quiet move was needed.
The new check uses the same Stockfish results and verifies two legal
continuations from the original board.

It first nominates an existing threat by examining the opponent's
immediate mating moves with no intervening action. That synthetic board
never appears as evidence. To return a diagnosis, a real legal move
must allow the same immediate mate, and the engine's non-checking
choice must leave no legal mate in one. Engine candidates are checked
first for the move that allows mate. If all of them defend, the check
can use a legal non-capturing, non-king move as an example. The app
shows that hypothetical move under **Show evidence**. When the
opponent's threat can still give check after the defence, it also
shows one legal answer.

The finding is a bounded tactical proof. It can accompany independent
positional evidence and applies to position character and the engine's
leading move. The played-mistake mechanism still uses its own comparison.

## Comparison

Development includes the first rounds in Hong Kong, Mont-de-Marsan,
and Bremen. It samples games with an actually played defence and
game-disjoint ordinary controls. The reselection in Mont-de-Marsan
contains 20 other games, one position per game. The development cohort
contains three ordinary controls from that same event. Position and
game identities were deduplicated against the previous replay inputs.
The sources are standard time control.
[Hong Kong round](https://lichess.org/broadcast/hong-kong-international-open-chess-championship-2025-open/round-1/zCDW4I8p) |
[Mont-de-Marsan round](https://lichess.org/broadcast/mont-de-marsan-christmas-open-2025/round-1/A2eX7efG) |
[Bremen round](https://lichess.org/broadcast/bremer-silvester-open-2025-a/round-1/PUX3qzCM)

The exact reference is an exhaustive legal-move replay in python-chess.
Positive cases require the same pre-existing mate to remain possible
after a legal alternative, and require the selected defence to prevent
every immediate mate. The reference excludes a checking leader, a
terminal position, and a leader with no usable finite engine score.
One reviewer checked the concrete lines and the mixed reserve example.
The controls test the new witness, so their labels do not imply a
general absence of tactics.

| Measure | Development | Game-disjoint reserve |
| --- | ---: | ---: |
| Positions | 23 | 20 |
| Eligible mate defences | 6 | 7 |
| Existing tactical assessment among eligible cases | 1/6 | 0/7 |
| Mate defence proof using only searched alternatives | 0/6 | 0/7 |
| Mate defence proof with a legal quiet example | 6/6 | 7/7 |
| Added tactical assessments | 5 | 7 |
| Incorrect mate defence proofs | 0/17 | 0/13 |
| New mixed positions | 0 | 1 |

White can play `Qe2` in the reserve queen position. `Qe1 Qxb2#`
shows the danger. After `Qe2 Qxb2+`, White can answer `Qxb2`.
In the mixed reserve ending, `...h5 Re7#` shows why Black must
address mate immediately. `...Ne4 Re7+ Kf6` provides an escape.
White's separate b-pawn plan remains relevant. It promotes on c8
after `...Ne4` and on b8 after the alternative `...Nd5` in the
engine lines. The position remains materially difficult for Black.

The 1,051-case compatibility replay includes 261 earlier public
positions, 472 archived decisions and 318 played-move comparisons.
One earlier comparison is invalid. Three positions and their leading
moves gain the new tactical evidence, including two with an existing
positional assessment. All 317 valid mistake diagnoses match the
previous implementation. The earlier 261 public positions contain
zero verified new witnesses. This enriched sample measures a
specific mechanism and cannot estimate recall across ordinary classical
positions.

The proof adds zero Stockfish searches. In a 261-position isolated
screen it took 0.057 ms median and 0.086 ms at the 95th percentile.
The actual worker and source-built panel were exercised with cached
Stockfish input at 320, 390 and 900 pixels. Expanded evidence showed
the defence, the move that allows mate and the legal reply. Keyboard
expansion and closing the evidence were checked.

The check handles immediate threats and a non-checking defence. A
checking tempo and a defence against mate in two or more need different
evidence. The comparison demonstrates avoidance of immediate mate and
does not establish the eventual game result or the only possible defence.

## Reproduction

- Use [protocol.json](protocol.json) for the exact PGN endpoints and
  hashes. The sampler is [scan.py](scan.py). Use the two selection
  cohorts separately and pass the previous sample inputs to
  `--previous`. Generate engine frames with `--engine`. Apply
  [reference.py](reference.py) to the resulting `engine.json`.
- The checked-in [input](input.json) contains the 43 matched cached
  engine frames. To replay without downloading PGNs or running an
  engine, set `MATE_DEFENCE_OUTPUT` to a new output path and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/immediate-mate-defence/vitest.config.mjs`
  from the repository root. Set `MATE_DEFENCE_REVISION=897eb626`
  for the baseline and use the implementation revision for the candidate.
- Compare position and move assessments with the exact mate-defence
  [reference](reference.json). The [result summary](results.json)
  contains the compatibility, tests and timing receipts. The
  regression suite is `src/utils/tests/decisionMateDefence.test.ts`.
