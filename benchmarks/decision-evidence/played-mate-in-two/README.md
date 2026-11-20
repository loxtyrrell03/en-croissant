# When the played move permits mate in two

Decision Evidence already confirmed mate in one on the board. For a longer mate it depended on paired root scores and a separate search of the played move. Accurate but incomplete engine frames could therefore fail to explain an exact short mate.

The new check replays the actual move and the alternative from the same board. It considers checking and quiet mating starts. After the selected start every legal defence must have a mating reply. The stronger choice must rule out every mate within two moves under the same short proof budget. If the board proof succeeds, the app can omit the scored played choices and the separate played-reply search. It still searches the leading move and its reply. The worker repeats the proof.

The explanation distinguishes a mating start the stronger move makes illegal from one it can meet with a concrete defence. Where available, it shows that counterfactual. It describes the two-move threat even if the stronger choice remains objectively worse in the engine evaluation. A best choice scored as an already-forced loss stays outside this rule. The engine's longer-mate mechanism remains available.

## Results

The development cohort contains 18 recorded standard-chess moves. The held-out cohort contains 42 from different tournament sources. The samples exclude all matching archived boards and all archived game prefixes with a recorded history. They are disjoint by game and colour-normalised board from each other. A handful of PGNs lack time-control tags. The reference independently enumerates the mates with python-chess. It labels the short mechanism rather than the entire decision.

| Held-out matched replay | Geometry positives detected | False calls across 24 controls |
|---|---:|---:|
| Previous worker, full searches | 11/18 | 0 |
| Previous worker, omitting played-specific searches | 0/18 | 0 |
| New worker, full searches | 12/18 | 0 |
| New worker, omitting played-specific searches | 12/18 | 0 |

All six remaining geometry positives had a longer forced mate against the mover even after the engine's best choice. This is why the denominator includes six cases where the new rule abstains deliberately. Among the 12 with a finite stronger score, the local proof found all 12. The 24 controls contain 18 cooperative lines, four immediate-mate cases, and two where every root choice still allows a short mate.

The prototype that searches checking starts alone found 11 of the 12 eligible cases. The prototype that relied on the actual separately searched opponent move found 12, but needed that extra search. The complete local variant found those same 12 directly from the board. A separate three-puzzle check, reconstructed from the original game scores, added a second confirmed quiet-start example. Two of the three were already forced losses at the original board. [Lichess game export](https://lichess.org/api#tag/Games/operation/gamePgn)

The skipped searches account for at least 30,916,911 Stockfish nodes across the 12 held-out proofs, using the final completed iterations from the fixed-node replay. This measures saved search work, with wall time depending on the position and engine. The local check adds zero engine calls. A regression exercises the normal search entry point and observes only the leading position and its reply searched when it can prove the played mate.

Across 1,869 valid archived reports the position and move reports match. One played-move assessment gains a verified mate in two. All 48 previous quiet-threat benchmark reports agree apart from the worker version. The prescribed board replay independently verifies every exported proof and the counterfactual where shown.

## Examples

- In Kovin, `Kh1` allows `...Rb1+ Kh2 ...g3#`. The stronger `Rh8+` means `...Rb1+` is no longer a legal reply. The previous full search did not yield a completed diagnosis there.
- In the rook ending after `...Kf4`, White starts the mating attack with the quiet `Bb1`. After `...Kd4` instead, the same `Bb1` can be met by `...Kxc5`. The app shows that precise difference alongside a forced mating line from the game move.

The proof abstains if it exhausts its search budget, the exact board or history is incompatible, or the stronger choice still permits mate within the same distance. This iteration addresses a specific tactical cause. Broader mixed and positional mistake coverage needs separate evidence. The source-built evidence panel displays the two lines with keyboard expansion at 320, 390 and 900 px. Installed desktop verification is pending.

## Reproduce

Use the retained public PGNs and historical inputs identified by hash in [results.json](results.json). Use Stockfish 19 with SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`, python-chess and the project Node dependencies.

1. Run `sample.py DEVELOPMENT MANIFEST SOURCES... --exclude ARCHIVE`. For the independent holdout use `--quota 18 --per-event 5` and add the development freeze to the exclusions. Use the event inputs listed in the results. The root labels are frozen before the engine comparison.
2. Use `puzzles.py PUZZLE_CORPUS QUIET_ROOTS` on the retained `neural-motif-transfer/puzzle-corpus-frozen.json`. Run `recover.py QUIET_ROOTS QUIET_CASES MANIFEST PGN_DIRECTORY` to recover the actual played moves and exact histories.
3. Run `analyse.py SAMPLER_OUTPUT ENGINE_FRAMES STOCKFISH benchmarks/decision-evidence/defence-after-attack`. It retains exact complete Stockfish iterations with one thread and 64 MiB hash. The root search uses 600k or 2.4M nodes, with replies at 1M or 4M.
4. From the repository root, run `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/played-mate-in-two/vite.config.mjs`. Set `MATE_TWO_INPUT` and `MATE_TWO_OUTPUT` to the run files. Leave `MATE_TWO_MODE` unset for the three local methods and use `worker` for the complete frames or `root` to omit played-specific evidence. Set `MATE_TWO_REVISION` to this implementation for the new worker and leave it unset for the previous worker. The score script lists the corresponding filenames.
5. Run `score.py RUNS ALLOWED_ROUTE_MISTAKES_RUN QUIET_MATE_IN_TWO_RUN results.json`. The archive uses the earlier `inputs.json` and `archive-next.json` benchmark files. Run the two focused proof and search suites to check wrong-board, wrong-history, cooperative-line and quiet-start regressions. For the source panel run `node benchmarks/decision-evidence/played-mate-in-two/verify-panel.mjs PLAYWRIGHT_MODULE CHROME_EXECUTABLE` with `MATE_TWO_REVISION` set to the implementation revision.
