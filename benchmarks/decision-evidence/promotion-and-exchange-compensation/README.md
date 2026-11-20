# Promotion exchanges and compensation for an exchange sacrifice

Two games lost their tactical verdict when the classifier stopped calling
ordinary recaptures discovered attacks. The follow-up traced the actual
continuations and compared them with separately searched replies. The
promotion evidence is in decision assessment v38. The exchange-sacrifice
candidate remains in this benchmark.

## A pawn can take a piece off the board by promoting

Follow the original pawn from its advance to the seventh through its
promotion and the two recaptures on that square. In two competitive
opponent replies, it must trade for the same type of piece on the same
promotion square. The two lines must stay distinct up to promotion and
retain at least 0.9 material points over two more plies. Both replies
belong to the same valid independent reply frame, within 50 centipawns of
the strongest examined reply. The position, the candidate move and any
played-mistake comparison keep their own evidence.

At the World Amateur U1700, a7 can be blockaded in one line and traded
for a rook in others. The advance retains the strategic passer evidence
and gains a distinct tactical explanation. A deeper reply search still
finds the pawn-for-rook trade after h3+ and g3. On the separate board
after Kf5, the leading choices in the deeper search delay the promotion.
The app describes the observed routes and their conditional outcome.
[World Amateur game](https://lichess.org/broadcast/fide-world-amateur-chess-championships-2026-u1700/round-7/PyXN5Fq9/Vqgwtmwa)

In the Deizisau game, d7 lets White exchange the passed pawn for the
bishop. The result holds at 0.00 in both independently reached promotion
positions. The 9.6M-node root search puts d7 at −0.17 and the next two
examined moves at −6.18 and −7.78. In Münsterland, a7 can trade the pawn
for a rook after two different defences, including a longer rook
manoeuvre. The deeper reply search keeps both defences level at −4.84
from the defender's perspective.
[Münsterland game](https://lichess.org/broadcast/43-munsterland-open-34-challengers-2026-a-open/runde-8/B8Gqv1Pd/7ElSBMsM)

The seven-ply prototype accepted only the shorter Deizisau exchange in
the first reserve. The one-reply variant also accepted Münsterland, but
lacked a second promotion line at that horizon. Expanding the horizon
to nine plies recovers both verified lines. The wider two-reply rule was
then run on a new 51-game sample from eight events absent from the first
reserve. No additional diagnosis met the two-reply condition.

| Matched replay | v37 position | v38 position |
| --- | --- | --- |
| World Amateur U1700, development | Positional | Mixed |
| Deizisau, 113-game first reserve | Unclear | Tactical |
| Münsterland, 113-game first reserve | Positional | Mixed |
| 51-game event-disjoint reserve | No qualifying addition | No qualifying addition |

The matched report comparison used 1,417 requests, including 1,051
historical requests and 202 separate classical requests. Three position
and three leading-move categories changed. The three added
explanations were checked with deeper searches. These are scoped
case findings, and the remaining games do not supply a complete tactical
ground truth. The evidence uses the existing root and reply searches.
The source-built panel showed the promotion comparison under both the
position and move at 320, 390 and 900 pixels.

## Why the Buongoma exchange is different

After Rxd5 Bxd5 Rxd5, White has given a rook for a bishop and a pawn.
The rook from d1 can recapture because the first rook left the d-file.
Rd6 leaves that rook active across subsequent moves. The alternative
Bf3 reaches Rd7 through a different and cheaper exchange. At 12M root
nodes, the restricted comparison scores the two choices +3.29 and
+2.73. Separate searches reproduce the first exchange and show that both
branches can put a rook well up the d-file.
[Buongoma game](https://lichess.org/broadcast/buongoma-open-chess-championship-grand-prix-circuit-open/round-5/SCvm4PlU/cv2U07pj)

The prototype checks that the material cost persists and that the rook
keeps the opened file in the repeated search. Its stricter variant also
asks for a competitive alternative that gains the same kind of access.
Neither variant added a diagnosis in the 113-game reserve. Within that
reserve, 25 games featured an exchange offer in play. The recorded move
led the search in 15 games. Comparing the other ten recorded moves with
the leader produced no additional competitive offers under the sampled
criterion. Buongoma remains a verified development example with no
demonstrated transfer for the proposed rule.

## Reproduce

Run from the En Croissant root. The two public sample manifests hold the
game histories and exact search positions. Search each with
`reply-search-allocation/gather.py INPUT ROOTS STOCKFISH`, then repeat
with `ROOTS FRAMES STOCKFISH --best-reply`. Use the Stockfish 19 binary
identified by the recorded hash. The two archival collections are the
same inputs from the [discovered-target replay](../discovered-target-identity/README.md).
The first sample uses the retained PGNs. The second uses the public
round hashes from the [neural shortlist reserve](../neural-deep-witness/reserve-manifest.json).

```powershell
$suite = 'benchmarks/decision-evidence/promotion-and-exchange-compensation'
$env:COMPENSATION_INPUT = 'C:/path/to/saved-frames.json'
$env:COMPENSATION_OUTPUT = 'C:/path/to/new-report.json'
$env:COMPENSATION_ARM = 'baseline'
node node_modules/vitest/vitest.mjs run --config "$suite/vite.config.mjs" screen.bench.ts
```

Repeat with a new output path, `COMPENSATION_ARM` set to `candidate`
and `COMPENSATION_REVISION` set to the commit containing this
benchmark. `reference.py` reproduces the historical checks and
`transfer_reference.py` reruns provisional positive cases. The
regression tests exercise the three app promotion fixtures and reject
missing, duplicated, too-short or board-mismatched evidence.
