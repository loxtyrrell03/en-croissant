# Comparing tactical exchange outcomes

An audit of 1,051 historical decision requests found 239 missed tactical
position labels and 54 missed tactical mistake labels. Their review
notes mention captures, exchanges, or material in 153 and 27 cases,
respectively. The counts describe the archived mix of ordinary and
challenge cases. The wording search identifies a family to investigate.

The comparison tests whether a material loss can be attributed to the
played choice when both searches show the same piece being taken. Each
piece is identified by its square on the original board, including when
it moves before capture. Legal replay handles both castling pieces and
the off-square pawn in en passant. Signed material comes from the same
value table for the played, better, and separately searched lines.

## Historical development

The first experiment evaluated 39 alternatives using an independent
Stockfish reply search. The table counts unique reviewed positions or
played mistakes that the current classifier had missed. The capture
requirements were tightened in separate arms. The reply analysis took
45 searches and 63.01 million Stockfish nodes across the 39 alternatives.

| Corroboration used | Added reviewed tactical positions | Added reviewed tactical mistakes | Reviewed false calls |
| --- | ---: | ---: | ---: |
| Settled material difference | 16 | 1 | 1 |
| Same delayed victim and forcing entry | 5 | 0 | 0 |
| Same victim and a change to the replayed attack after the better move | 3 | 0 | 0 |

The material-only arm could promote a reviewed positional mistake after
`...Rbg8`. The b-pawn advance followed by captures on c5 and d6
produced a lasting deficit. The review attributed the move's problem to
the loss of timely queenside counterplay. The material difference alone
could not establish a tactical mechanism.

The first two rules also missed all three reviewed exchange mistakes
in the separate 34-game sample. A revision compared the first quiet
checkpoints and allowed partial material recovery when a relative cost
persisted. That revision also missed all three. The review exposed
two problems. A delayed capture can be common to both branches while
an earlier capture makes the real difference. A materially relevant
sequence can include quiet moves between its checks and captures.

## Piece-by-piece comparison

The next trial required the same opening check or capture in both
searches of the weaker choice. It then compared the entire set of
captured pieces through the exchange and checked which survived after
the better move. A second arm checks retention against a separate
search following the better move. Both arms compare material only
after each side has had a quiet move and corroborate the original
engine evaluation on the weaker child.

| Method | First sample, 34 games | Separate transfer, 31 games |
| --- | ---: | ---: |
| Existing tactical diagnosis on reviewed positives | 2/3 | 0/3 |
| Existing diagnosis plus captured-piece comparison | 3/3 | 0/3 |
| Existing diagnosis plus comparison checked against the separate better reply | 3/3 | 0/3 |
| Reviewed negatives | 20 | 15 |
| Uncertain references | 11 | 13 |

The captured-piece comparison recovered a development explanation
after `Be2`. Both searches begin with `...Bd3+` and later capture
the bishop from f1. After `Qc3` that bishop survives in both compared
lines. In a separate example after `Nh4`, checking the two stronger
lines leaves the d1 rook and f3 knight as supported distinguishing
pieces. Both pawns named by the first comparison are captured in
another credible line after `Rf1`.

Another counterexample starts `Qb3 Bxg2`. The first comparison
credited `Qd2` with keeping the pawn from g2. A separate search
also takes that pawn after `Qd2`, with different compensation.
The additional check correctly withdraws the named pawn claim.

In the untouched Karlstad sample, both `Bf4` and `Kg1` allow
`...Nxa1`. The stronger `Kg1` continuation then uses `Ne5`,
`Ngxf7`, and `Nxd6` to recover material. The current experiment
measures material conceded along the weaker route. This case
depends on material recovered through the stronger route.

The typed trial adds zero tactical calls on the reviewed negatives
of either sample. The transfer has only three reviewed positive
cases. There is no verified transfer gain from the proposed
rule, so the implementation remains a benchmark candidate.

## Reproduction

- The [protocol](protocol.json) pins the tournament sources, time
  controls, sampling receipts, engine and manually reviewed labels.
  Karlstad uses only rounds 3–8, which used 90 minutes plus a
  30-second increment. Rounds 1–2 were rapid.
  [Karlstad broadcast](https://lichess.org/broadcast/karlstad-open/round-1/Kl8Qj5tE)
- [screen.py](screen.py) and [probe.py](probe.py) rerun the historical
  comparison using the 1,051 input and baseline reports from
  the earlier compatibility replay. [resolve.py](resolve.py) reruns
  the variant that tolerates partial material recovery.
  [Historical compatibility replay](../immediate-mate-defence/README.md)
- [collect.py](collect.py) samples the public games independently
  of the candidate output and produces matched root and reply frames.
  [ledger.py](ledger.py) scores the full captured-piece comparison.
- Set `EXCHANGE_OUTPUT` to a new path and run
  `node node_modules/vitest/vitest.mjs run --config benchmarks/decision-evidence/compared-exchange-outcomes/vitest.config.mjs`
  from the repository root. The test replays identical [input frames](input.json)
  through the captured-piece comparison and the baseline, then checks
  the [results](results.json) against the [reviewed reference](reference.json).
