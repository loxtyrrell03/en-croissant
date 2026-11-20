# Interference that removes an actual recapture

The older live scanner primarily proved interference through forcing or
all-defence searches. The line-route checker now also recognises how a cut
defence is used in a particular continuation. It replays legal moves, checks
that the original sliding defender could profitably recapture the original
attacker, then removes only the interposing piece at the payoff board. The
same recapture must become legal and profitable again. The actual capture
must keep a material gain after a bounded local exchange check or give
checkmate. Castling, promotions, changes in the pieces' roles and alternative
causes for a blocked recapture can invalidate the evidence.

The live panel calls this **Interference in this line**. Decision Evidence
promotes the finding only when the separate search of the opponent's best
reply corroborates the same four chess roles and consequence. Existing
stronger interference proofs take precedence in the live panel. A repeated
line supports the tactical dimension alongside any strategic evidence.

## Paired results

A Python-chess challenge scan selected 60 potential uses of cut defences and
37 nearby controls from 13,680 existing Lichess puzzle positions. The 24
development roots and 44 challenge roots are split by game and deduplicated by
board, including colour mirrors. Held-out selection prioritised the previous
puzzle corpus's validation and test partitions, with additional puzzle roots
unseen in this experiment drawn from its train partition. Previous route
benchmark games and boards were excluded. Decisions were labelled by
legal recaptures and exchanges on freshly scored lines, independent of the
original puzzle theme tags. These are mechanic-specific, single-reviewer
references with a bias toward likely cases. They do not measure overall
motif accuracy.

Stockfish 19 searched the exact root move at 2.4 million nodes and then
searched up to three replies at 4.8 million nodes from the reached board.
Both product revisions received identical recorded frames. The first and
second search positives must share the original interposer, defender, target
and capturing piece to count as a repeated use.

| Scope | Reference positives | Baseline hits | New hits | Baseline → new on controls |
| --- | ---: | ---: | ---: | ---: |
| Development, live | 12 | 4 | 11 | 1/12 → 1/12 |
| Development, Decision Evidence | 12 | 4 | 11 | 1/12 → 1/12 |
| Held-out, live | 20 | 8 | 16 | 2/24 → 2/24 |
| Held-out, Decision Evidence | 19 | 8 | 15 | 2/25 → 2/25 |
| Classical, live | 1 | 0 | 0 | 0/28 → 0/28 |
| Classical, Decision Evidence | 0 | 0 | 0 | 0/29 → 0/29 |

The held-out geometry-only rule hits all 20 first-line positives and also
fires on 21 of 24 controls. Both pre-existing held-out control labels concern
different interference claims outside the test definition. Neither path
adds a label on its controls. The full worker adds four held-out tactical
position diagnoses and no mixed diagnosis at the original budget.

The classical check used 29 recorded candidate moves from separate games
across nine classical event files with eligible rows. Eleven had a possible
cut in the played continuation and 18 were nearby controls. With fresh
searches there were 27 cases with no qualifying cut in either line and two
with a qualifying cut in only one line. The change yields no new classical
diagnoses in this challenge. At a doubled node budget, all eight new puzzle
live proofs recur in both searches. Neither classical exception repeats.

## Exact cases

- **Lichess 4P26i.** 11.Nc7+ Kf8 12.Qxc5+. The knight blocks the black
  queen on c8 from recapturing on c5. With the same evidence both searches
  now diagnose a tactical position.
- **Lichess 04Qx2.** 23.Be8+ Qg7 24.Qxg7+ Kxg7 25.Rxc8. The bishop cuts the
  f8 rook's route to c8. The software identifies the fifth ply as the
  payoff, after the queen exchange.
- **Lichess 0atE3.** The lower-budget live line shows 31.Nb5 Kg7 32.Rxb3.
  The separate reply does not confirm that use at that budget. At twice
  the nodes both searches show 31.Nb5 Ke7 32.Rxb3. The position changes
  from positional to mixed. The knight occupies a pawn-supported square
  that cannot be driven away by an opposing pawn advance, and it cuts
  the b7 rook's ability to recapture on b3.
- **Irish Championship, 28.Rc6.** The lower-budget fixed search favours
  28...Nf8, while the independent search gives 28...Nb6 29.Qxc5 as in the
  actual game. Both deeper searches prefer 28...Nf8. The application
  does not attribute the move to interference.
- **Irish Championship, 18...Nd4+.** 19.Kd1 Qxc4 appears in one search,
  while the independent search gives 19.Kd3 b5 at both budgets. The actual
  game has 19.Kd3 e4+ 20.Kd2 Qxc4. The application withholds the diagnosis.

The four surviving held-out misses illustrate limits around pawn captures,
compensation, and sacrificed blockers. The reference exchange calculator
uses captures on the payoff square. The app also checks nearby liabilities
and net material through the payoff, and deliberately abstains when this
cannot be established. The mate branch has a constructed legal regression
with a restored defensive recapture. Its coverage has no measured real-game
sample here. The current scope requires the original defender and victim
to keep their roles until the payoff. It does not cover all uses of
interference or prove outcomes against every defence.

## Cost and reproduction

The change uses existing scored moves and makes no extra Stockfish calls.
The median worker time over 1,869 valid archive reports was 72.54 ms before
and 73.30 ms after in separate runs. All report contents except the cache
version match across the archive. Source browser verification uses the
actual worker and evidence panel with recorded Stockfish frames at widths
320, 390 and 900 pixels. See [results.json](results.json) for exact counts,
positions that changed, engine input hashes and hashes of the classical
event files.

Use Python 3.13 with python-chess and the same Stockfish 19 binary
(SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`).
Reuse existing local datasets. The original puzzle corpus is
`neural-motif-transfer/puzzle-corpus-frozen.json` (SHA-256
`9f3d2bdf595a3eac9f1d4f049f3937c03248bfa5595e3c4709f6b6ee30f1fee0`).
The earlier puzzle exclusions are `scored-route-decisions/reserve-scored.json`
and `scored-route-decisions/holdout-scored.json`. The archive input is
`allowed-route-mistakes/inputs.json` (SHA-256
`8b1a441dc4666f722bca3e415f0827085f8e40cbd7f19ccf4d6d9d8990b8015f`).

1. From the repository root, run `scan.py CORPUS geometry.json` and
   `prepare.py freeze geometry.json development.json heldout.json --exclude RESERVE HOLDOUT`.
   Run `classical.py classical.json classical-manifest.json PGNS... --exclude ARCHIVE`
   with the event files listed in the results. Each source contributes at
   most five games per case type.
2. For each split run
   `prepare.py search SPLIT.json SPLIT-scored.json STOCKFISH benchmarks/decision-evidence/defence-after-attack`.
   To reproduce the deeper recheck, select the eight IDs in the held-out
   `newLive` results plus `classical-cut-316f2053b5844488` and
   `classical-cut-650d6e134aa17abc` from the unscored inputs, in that order.
   Run the same command with `--nodes 4800000`.
3. Run
   `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/interference-in-line/vite.config.mjs`
   with `INTERFERENCE_INPUT` pointing to each scored input and
   `INTERFERENCE_OUTPUT` pointing to a new `SPLIT-base.json` or
   `SPLIT-next.json`. Leave `INTERFERENCE_REVISION` unset for the
   pinned baseline, or set it to the candidate commit. For the archive use
   the same configuration with `INTERFERENCE_MODE=archive` and the 1,875
   existing inputs. The archive baseline was already recorded at
   `48a81d92`.
4. Run `score.py RAW_OUTPUT_DIRECTORY ARCHIVE_BASELINE OUTPUT`.
   `fixtures.json` additionally preserves six small scored examples for the
   route and panel regressions. Run `node verify-panel.mjs PLAYWRIGHT_MODULE CHROME`
   from the repository root using the script's repository-relative path.
