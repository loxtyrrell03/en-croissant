# Same-position tests for passed-pawn decisions

The previous neural experiment had no held-out pair in which the original
pawn had opposite, definite outcomes after two root choices. This study
samples pairs explicitly and checks two distinct targets: whether a pawn
actually advances and survives in searched continuations, and whether the
same immediate push is sound if played on both boards. These are possible
supervision targets for a model. Neither target by itself labels an entire
position or establishes why a move lost evaluation.
[Previous neural experiment](../neural-passer-probe/README.md)

## Sampling and results

The sample keeps one advanced-passer decision from each of 480 public
classical games. The development sample has 320 games from 36 event
families and the transfer has 160 games from 19 others. The runner checks
game identity and colour-normalized root and reached boards across the
split. Sampling reuses retained broadcast PGNs with at least 60 minutes
at the start of each game in the event manifest. No private game is used.
Neither candidate moves or captures the original pawn, which removes one
easy shortcut. The alternative is a plausible Stockfish candidate. When
the played move and alternative differ in score, the test considers the
gap separately from the pawn's fate.

| Search stage | Development | Transfer |
| --- | ---: | ---: |
| Complete preview pairs | 271 | 140 |
| Continuation pairs searched at the reference budget | 68 | 52 |
| Initial advance-versus-restraint contrasts | 2 | 1 |
| Initial contrasts repeated at 3.6M nodes per query | 1 | 1 |
| New contrasts found on the deeper disagreement checks | 0 | 1 |
| Exact same push tested after both root moves | 38 | 20 |
| Initial viable-versus-refuted push contrasts | 2 | 2 |
| Push contrasts repeated in both stronger search methods | 1 | 1 |

The continuation reference includes 20 controls per split
with no preview contrast. Only three per split have known outcomes on both
branches. None of those is an initial contrast. Search revisits 25 pairs
with opposite evidence somewhere in their lines. The four positive push
comparisons are all rechecked. The higher-budget single-move comparisons
sometimes disagree on the score order of the two replies. A separate
exploratory check searches the original pawn push and the leading reply
together at the same depth. One case lost on the higher-budget single
search returns in the matched search. It stays uncertain.

Only five distinct pairs have a definite contrast in either target at the
stronger budget. The two confirmed push pairs and the three stronger
continuation pairs are disjoint. Close Stockfish alternatives can follow
different plans, refute a pawn push while taking a different route to the
same evaluation, or take a passer that deliberately diverts a piece.
Geometry and pawn survival both have limited value as labels for the
overall decision. The surviving comparisons are too few for a meaningful
new neural fit or an estimate of general mixed recall. The shortlist is
enriched for advanced passers. These counts do not estimate their
prevalence in ordinary classical games.
[Counts and input hashes](results.json) · [Search protocols](protocol.json) ·
[Restricted-push protocol](forced-push-protocol.json)

## Reviewed comparisons

The manual notes distinguish the exact pawn outcome, the tactical
mechanism, and the move or mistake label. They are a single review and
not a labelled census of the sample. Exact reply restrictions were run
after review selected these cases. The committed Decision Evidence
worker at `e1321bf6` was replayed with the stronger frames from all 25
continuation rechecks.

- **Lugano, 41...Rd4 versus 41...Rb2.** After either move, White can play
  `b7` and Black can play `...Ne3+`. After `...Rd4`, White steps forward
  with `Ke2`, then `Kxe3` wins the knight in the leading restricted line.
  After `...Rb2`, the rook controls e2 and f2. The same knight check gives
  Black time to stop the passer. The restricted line swings from +7.89 to
  −0.04 for White after the same `b7 Ne3+`. Immediate `...Rxb7` loses to
  `Rxb7`. This supports a mixed explanation for the stronger rook move
  and a tactical defence missing after the played choice. The current
  worker leaves both move and mistake explanations unclear.
  [Lugano game](https://lichess.org/broadcast/xix-international-chess-open-lugano-standard/round-1/r2h3ZELp/nzJyOclZ)
- **Hoogeveen, 50.Kg2 versus 50.Kf3.** In the exact common continuation
  `...Rd6 b7 Rxd3`, the rook capture checks the king on f3 and forbids
  immediate promotion. With the king on g2, `b8=Q` is legal and strong.
  White still has other winning moves after `Kf3`. This is a verified
  dependency of the promotion plan and supports a mixed explanation for
  `Kg2`. The worker already describes the structural role of the passer
  in the position, while the explanation for `Kg2` remains unclear.
  [Hoogeveen game](https://lichess.org/broadcast/hoogeveen-open-2026/round-7/o4Nw35Ls/tl5cKsPg)
- **Arad, 45.Ke3 versus 45.Kd1.** The same `...c2` is strong after
  `Ke3` and gives away the pawn after `Kd1`. Black retains a large
  advantage after `Kd1` by playing `...Kd4` instead. The viability
  contrast is real and does not establish a root-move improvement.
  [Arad game](https://lichess.org/broadcast/19th-arad-open-grand-prix-classic-2026-open-a/round-7/6SJEilNL/IyHnYsC4)

[Reviewed scopes](reviewed.json) · [Selected exact search frames](examples.json) ·
[Restricted continuations](review-paths.json)

## Reproduce

Use the retained `classifier-rework` directory, Python with python-chess
and NumPy, and Stockfish 19. The binary hash is
`45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.
Run the scripts from the repository root with their full path. Full run
outputs are retained under `classifier-rework/paired-passer-benchmark`.

1. Run `sample.py LAB sample.json EXCLUSIONS...`. Exclude
   `neural-search-yield/train.jsonl`, `test.jsonl`, and `reserve.jsonl`
   under the lab. The sampler uses the retained public source manifests.
2. Run `search_pairs.py preview sample.json STOCKFISH preview.json`,
   then `reference preview.json STOCKFISH reference.json`, then
   `adjudicate reference.json STOCKFISH adjudication.json` with that
   same script.
3. Run `forced_push.py first preview.json STOCKFISH forced-first.json`.
   Run both `repeat` and `matched` from the resulting `forced-first.json`
   to produce `forced-deep.json` and `forced-matched.json`.
4. Run `summarize.py RUN_DIRECTORY reviewed.json OUTPUT EXAMPLES` and
   `review_paths.py preview.json review-requests.json STOCKFISH OUTPUT`.
   The saved hashes identify the original input captures. Search timing
   fields can vary between runs. `test_search_pairs.py` checks asset
   identity, the evidence window, and the promotion legality contrast.
5. Run `worker_inputs.py adjudication.json stronger OUTPUT`. Use that
   output as `MATE_THREE_INPUT` in the
   [worker replay](../played-mate-in-three/README.md#reproduce). Set
   `MATE_THREE_ARM=product` and `MATE_THREE_REVISION=e1321bf6`.

The screens and research checks are offline. The protocol captures
independent tactical and strategic evidence for two reviewed move
justifications. Broad motif and mistake recall still need independent
evaluation.
