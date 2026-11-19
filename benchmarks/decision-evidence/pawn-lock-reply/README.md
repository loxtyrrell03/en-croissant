# Strategic locks and tactical replies

The decision classifier used to treat a durable-looking pawn lock as
independent positional evidence. That could count one tactical action
twice. In the Puerto Rico team open position, the principal line after
`29...f3` leaves the f-pawns facing each other for several moves. The
separate search rates `30.Nxg8` the same as `30.Qb8+`. Against
`Nxg8`, the same pawn immediately plays `...fxe2`, taking a bishop.
The position and move now retain the verified fork while withholding
credit for an independent strategic lock.

In decision assessment v27, a legal, independently searched reply has to
be within 35 centipawns of the leading reply. The exact root pawn has to
execute the witnessed fork at its first opportunity and take at least a
minor piece. Other pawn moves or merely geometrical attacks never invoke
this rule. The upheld `b6` example shows why the strength of the reply
matters: the queen grab on b6 is inferior and the push supplies a separate
strategic factor. [Exact engine frames](examples.json)

## Measurements

| Replay | v26 | v27 |
| --- | ---: | ---: |
| Development false mixed verdicts | 1 of 48 reviewed negatives | 0 of 48 |
| Development mixed positives found | 2 of 77 | 2 of 77 |
| 34 new classical decisions, mixed positives found | 0 of 16 | 0 of 16 |
| 20 new classical pawn-lock cases, mixed positives found | 1 of 13 | 1 of 13 |

The pawn-lock correction changes one position and one move in the 182
development replays. All other position and move reports match in the
54 new cases and the 472 archived position replays. The 317 valid
paired mistake reports and their outcome statuses match exactly. One
archived case is unavailable in both versions. The position and move
evidence panels were exercised with their actual classifier worker and
recorded Stockfish inputs at 320, 390 and 900 pixels. The change adds
no searches. This evidence concerns the correction and compatibility.
The new samples add no positive mixed detections, and contain few clear
positional negatives. [Counts and replay checksums](results.json)

## Reply comparison experiment

An additional prototype compares replies to the leading root move. It
tests whether a rook reaches the sixth or seventh with the same legal
route in two searches and whether a different, close reply excludes
that route. The tactical comparison checks whether a weaker reply
allows a concrete gain of at least two pawns relative to the stronger
reply. The stricter variant only considers a legal capture or check as
the weaker reply. A second rook variant allows the two materially
comparable continuations to finish their recaptures before comparison.

In development this recovered the real `...exd5 Rxd5 O-O Rd7` rook
invasion and the `b6 Qxb6 Qxe5+` tactic. The engine's legal alternative
`Rhe1+` leads to a different rook file. In the second game, `Qd6`
protects e5 and avoids the material sequence. The 34 fresh cases
contain 24 random positions and ten enriched by a small engine preview
for tempting replies. Each comes from a different game and the
position-axis labels were reviewed before opening the prototype
predictions. Neither prototype found an additional classification
there. The four experimental arms run only in the benchmark.

## Reproduce

The public inputs include sampled FENs, reviewed axes and exact
Stockfish lines. Use the opt-in replay from the repository root, set
`DECISION_CONSEQUENCE_INPUT` to either public input file and
`DECISION_CONSEQUENCE_OUTPUT` to a fresh output path.

```powershell
$env:DECISION_CONSEQUENCE_INPUT = 'benchmarks/decision-evidence/pawn-lock-reply/heldout-replies.json'
$env:DECISION_CONSEQUENCE_OUTPUT = 'C:/path/to/new-reply-results.json'
& ./node_modules/.bin/vitest.CMD run --config benchmarks/decision-evidence/pawn-lock-reply/vitest.config.mjs
```

The default uses the recorded incumbent and the revised prototype.
Set `REPLY_CLASSIFIER_REVISION` to the v27 source commit for the
correction or `REPLY_EXPERIMENT_VERSION=v1` for the initial prototype.
The three modified incumbent sources are read directly from Git. Use
the recorded revision for other sources if reproducing on a later
checkout with classifier changes.

`sample.py` and `sample-locks.py` select distinct games from the public
round exports in [the provenance manifest](protocol.json). They take
an external output directory with those PGNs, Stockfish and the
earlier board manifests for exclusion. They reuse the [matched engine
search](../opened-rook-file/prepare.py). The archived inputs allow
replay without repeating the engine work. Changes on the two motivating
boards have focused regressions via `decisionPawnLockEvidence.test.ts`.
