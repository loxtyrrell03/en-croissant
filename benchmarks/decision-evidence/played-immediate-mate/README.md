# A played move that allows mate in one

Decision Evidence previously needed three aligned search results to label
this mistake. It used the leading move, a scored comparison including
the played move, and a separate opponent reply that confirmed mate. A missing
played search could therefore leave the diagnosis unavailable even when
the legal board already proved the opponent could checkmate immediately.

The direct check replays the actual move and enumerates its legal
replies. It must find one that ends in checkmate. The leading engine
choice needs an exact, finite score at depth 16 or deeper, a legal
continuation, and no immediate mating reply. The two moves are compared
from the same original position. An already established forced mate
against the mover is outside this diagnosis. When exact game history
proves play ended in a draw, the local check abstains.

The worker rechecks the board proof. The search still examines the
leading move and its reply for position and move evidence. It skips
the paired search and the played-move reply search when the immediate
mate proof is available. The result displays the actual mating
continuation and the alternative, and uses a chess outcome rather than
converting checkmate to a numerical loss.

## Comparison

Development used 14 games from earlier classical sources and yielded
three known lost-mate controls and no eligible positives. The rule
then transferred to a separate 43-game sample. The sampler enumerated
recorded moves and selected immediate-mate candidates, unavoidable
mates, and ordinary controls. Each game and color-normalized board
appears once. The
independent reference uses python-chess to replay real history and
enumerate the legal replies on both exact child positions.
[Johor](https://lichess.org/broadcast/johor-chess-festival-2025-international-open/round-1/ydanqrtt) |
[Zamenhof Memorial](https://lichess.org/broadcast/xliv-memoria-szachowy-ludwika-zamenhofa-2025-grupa-a/runda-1/lXd9UXnZ) |
[Wittelsbach](https://lichess.org/broadcast/12-wittelsbacher-weihnachtsopen-2025/round-1/igvaoEA5) |
[Jesenik](https://lichess.org/broadcast/xmas-jesenik-open-2025-main/round-1/ItsEiujn)

| Held-out replay | Verified immediate-mate diagnoses | False immediate-mate diagnoses |
| --- | ---: | ---: |
| Previous assessment, full searches | 8/8 | 0/35 |
| Previous assessment, leading choices and best reply only | 0/8 | 0/35 |
| Direct proof, full searches | 8/8 | 0/35 |
| Direct proof, leading choices and best reply only | 8/8 | 0/35 |

The retained diagnoses have identical evidence with and without the
two played-move searches. The skipped searches accounted for
17,460,412 observed Stockfish nodes across those eight positions.
This is a node count for the controlled replay. The wall-clock impact
depends on the engine and the position.

In Johor, `...Kf6` permits `Rf7#`. `...Kxe7` avoids mate in one
and retains a positive engine evaluation for Black. In the Zamenhof
sample, `Qh4` allows `...Qxg2#`, whereas `Rac5` avoids immediate
mate. Two of the eight cases had a positive leading evaluation for
the side to move. The other six already had a negative finite
evaluation. Avoiding immediate mate is a narrower claim than saving a
draw or win. The 35 controls include 15 cases with an existing
negative mate evaluation.

The earlier 1,051-request compatibility replay has 1,050 valid
reports and includes 317 played-move comparisons. Position, move, and
mistake assessments match the previous version throughout that replay.
The new tests cover the search bypass, mismatched boards, an already
forced mate, a newly created mating threat, and an automatic
fivefold-repetition draw. The source-built panel and worker were
checked with cached engine input at 320, 390 and 900 pixels.

## Reproduction

- [Protocol and source hashes](protocol.json) records the engine and
  event definitions. [collect.py](collect.py) samples the public PGNs
  and reruns the matched Stockfish searches. It reuses the original
  root and reply budgets.
- The 57 matched [inputs](input.json) include the real move and game
  prefix plus the exact engine frames. Set `PLAYED_MATE_OUTPUT` to
  a new file and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/played-immediate-mate/vitest.config.mjs`
  from the repository root. Set `PLAYED_MATE_REVISION=ee308917` for
  the baseline or use the implementation revision for the candidate.
- Each report contains a full-frame run and a reduced-frame run.
  [Reference and legal witnesses](reference.json) records the
  independent eligibility, results and skipped nodes per game.
  [Summary](results.json) contains the comparative totals.
