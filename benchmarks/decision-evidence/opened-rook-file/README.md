# Pawn exchanges and recurring rook-file activity

The previous tactical checkpoint confirmed `Ne7` in a World
Amateur game. The position assessment still missed the strategic
reason to consider the f-file. After the competitive choices
`37.Nd5` and `37.Kg1`, a competitive `...f4` reply leads to
`gxf4`. The same black rook then uses the newly available file
with `...Rf5` and `...Rxf4`, respectively. The former appears in
the separate reply search and the latter in the root analysis.
The fork still belongs to its own `...Rf6) branch.

## Comparison

Five candidate rules were tested. The first matches an observed
rook advance after a pawn leaves its file in two distinct root
choices. Next, both root variations and independently searched
close defences can supply evidence. The version that tracks the
original pawn and the original rook also requires a separate
reply search. The fourth version admits continued pressure by a
rook already on the file after the pawn exchange. The fifth
requires an actual rook move in at least one branch and checks
the same pressure target over two further plies. All methods
use the same best choice and top alternatives at a given budget.

The 53-position sample contains 40 independently selected
ordinary positions and 13 marked for a rook-file change in the
recorded game. The 25-position Korea reserve contains 20 ordinary
and five marked cases. Each position comes from a different game.
The labels are based on legal Stockfish lines with no classifier
output visible at review time. They come from a single reviewer.
The first three methods had frozen code at the first evaluation.
The pressure variants were developed after seeing those misses
and evaluated on the separate Korea reserve.
[Rudar round robin](https://lichess.org/broadcast/rudar-xxxvii-gm-round-robin/round-1/jFsKFqZe)
[Serbian Women's Championship](https://lichess.org/broadcast/20-pojedinacno-prvenstvo-srbije-za-sahistkinje/round-1/gib2xXny)
[World Junior Open](https://lichess.org/broadcast/fide-world-junior-chess-championship-2026-open/round-1/5JLs2gkn)
[Buongoma Open](https://lichess.org/broadcast/buongoma-open-chess-championship-grand-prix-circuit-open/round-1/65fuD8yZ)
[Korea Standard Open](https://lichess.org/broadcast/korea-international-chess-festival-2026-standard-open-a/round-1/3b6oROnj)

| Candidate | Initial 53 with ordinary search, TP / FP | Korea reserve at ordinary search, TP / FP | All 78 with more reply searches, TP / FP |
| --- | ---: | ---: | ---: |
| Root lines | 0 / 0 | 0 / 0 | 0 / 0 |
| Allow separate replies | 0 / 0 | 0 / 0 | 0 / 0 |
| Track the same pawn and rook | 0 / 0 | 0 / 0 | 0 / 0 |
| Allow continued rook pressure | 0 / 1 | 0 / 0 | 1 / 4 |
| Require observed rook movement | 0 / 0 | 0 / 0 | 1 / 2 |

The denominators for the exact rook-file mechanism are three
positives and 46 negatives in the first sample, then one positive
and 22 negatives in the reserve. The remaining six references
are uncertain. The ordinary search supplies a separate search
after the leading choice. The wide comparison supplies reply
searches after competitive alternatives. These cost at least
142 million more nodes in total, counting their final attempts.

The wider search finds a real use of the d-file in the World
Junior game. `...Rad8` and `...Rfd8` both lead to
`...d4` and a rook retaking on d4 after the exchanges settle.
It also reports the f-file in a Rudar game where one rook is
passive and the c-file in a Buongoma game where the sequence is
short-lived tactical counterplay against a knight. The stronger
rook-movement screen still produces both overstatements.

At the ordinary budget the incumbent assesses 13 of 44 reviewed
tactical positions, 16 of 63 positional positions, and one of
30 mixed positions. It has zero reviewed false positives in
these samples. More reply searches alone raise positional recall
from 16 to 20 of 63 and leave mixed recall at one of 30. No
rook-file candidate improves mixed recall on these boards. The
best development example would become mixed, but that case
informed the design.

## Reproduce the experiment

- Use the public sources in `sources.json` and exact sampled FENs
  and references in the two manifests. `prepare.py` recreates the
  Stockfish root and reply frames in an external output directory.
  It takes the output directory containing the named PGNs, the
  Stockfish executable, and a JSON array of previously used
  positions. Use `--reserve` for Korea and include the 53 earlier
  positions in the exclusion input. The manifests capture the
  exact source PGN hashes because broadcasts can change.
- Apply `candidate.patch` to the recorded baseline in a scratch
  index or checkout. The patch adds an offline module and replay
  test. The test reads the input and output paths from
  `DECISION_OPEN_FILE_INPUT` and `DECISION_OPEN_FILE_OUTPUT`.
  Supply `replyProbes` for the ordinary search and replace them
  with the review-only `referenceReplies` for the wide run.
- `summary.json` records all arms and uncertain outcomes.
  `witnesses.json` contains the key exact lines and controls.
  The additional classifier work across all five arms was under
  five milliseconds median per board. It excludes engine search.
  The experimental code remains outside the application.
