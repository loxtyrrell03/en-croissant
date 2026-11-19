# Verify the critical move in a prepared tactic

The previous position assessment filtered out a tactical preparation
when its payoff arrived after ply five. In the World Amateur example,
the move assessment already found a fork route after
`37.Nd5 Rf6 38.Rxc6 Rfxc6 39.Ne7 R8c7 40.Nxc6`. The position
assessment was unclear. At the position after `38...Rfxc6`, an
independent search puts `Ne7` 3.21 Stockfish evaluation points above
`Ne3`. The same piece makes the preparation and the fork.

Decision Evidence v26 requests this check only if a supported
preparation in the leading move has been excluded from the tactical
position verdict. Its legal mechanism must appear in one of the
independently searched replies within 0.35 evaluation points of the
leading defence. Stockfish receives up to 1.4M nodes at the board
immediately before the mechanism. It must retain the exact move as
best at depth 16 or more and show at least a 1.50-point gap over the
runner-up, with a stable evaluation. The panel shows both continuations
and identifies the defence in which the result was checked.

In Aruba the output goes from positional to mixed. After
`24.a4 e5 25.a5 exf4`, the independently checked `26.axb6`
is 4.35 points stronger than `26.exf4` and diverts the queen to
b6 before `gxf4`. The existing strategic explanation is retained.
The Brazilian `Rd6` and AQ Prime `Rd2+` cases fail the
critical-move comparison and retain their original position verdicts.
The new comparison concerns the shown defence. The other replies can
lead to different requirements.

| Evidence | Before | After |
| --- | ---: | ---: |
| Reviewed tactical positives in the 33-position replay | 2 / 18 | 3 / 18 |
| Reviewed tactical false positives | 0 / 10 | 0 / 10 |
| Reviewed positional positives | 8 / 26 | 8 / 26 |
| Reviewed mixed positives | 0 / 11 | 0 / 11 |
| Position reports that gained a verified tactical continuation across all 472 inputs | 0 | 3 |

The 33-position replay includes the World Amateur development case,
so the additional detection is evidence for that position and does
not establish a general recall improvement. Aruba's old tactical
reference is uncertain. The private Woodpecker replay adds a
separately verified tactical continuation to an unclear position.
Its reference assessed the justification for the move. It does not
serve as a position-character label. The private position and
continuation stay outside Git.

Five of 472 positions requested the extra search. Those requests
took 1.02 seconds median on one Stockfish thread. The analysis keeps
the existing session deadline and can still use the previous fallback
when this search is inconclusive. In a separate paired replay of
318 saved move comparisons, the 317 valid reports retained all move
and mistake results and one report remained unavailable.

## Reproduction

- Use `public-fixtures.json` for the four exact public positions and
  `decisionPreparedCheckpoint.test.ts` for positive and adversarial
  controls. The decision gap is in Stockfish's normalized evaluation
  units. The fixture keeps the exact board at the checked ply.
- Reuse the Stockfish 19 candidate and defence frames in the ordinary
  v33–v40 library, the 33-position Reykjavik, Prague and World Amateur
  replay, the v13 independent and private course replays, and the
  80-case recapture reserve. Input rows contain `id`, `fen`,
  `candidates`, `replyProbes` and optional `label`. Add
  `preparedCheckpoint` with the MultiPV lines at the requested board
  in the candidate arm. Run `decisionPreparedCheckpointReplay.test.ts`
  with `DECISION_PREPARED_REPLAY_INPUT` and a fresh
  `DECISION_PREPARED_REPLAY_OUTPUT` against the two revisions.
- Source-built browser checks exercised the real report worker with
  recorded engine frames at 320, 390 and 900 pixels. They covered both
  the confirmed branch and the fallback after an inconclusive check.
  Native runtime delivery has not been verified.
