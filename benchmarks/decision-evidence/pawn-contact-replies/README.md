# Pawn pressure across alternative move orders

Different good moves can leave the same pawn lever central to the position.
In the New York game used for development, both `Bxa7` and `a4` lead to
White challenging the original b5 pawn with the original a-pawn. After
`Bxa7 Rxa7 a4`, Black advances it with `...b4`. In the other app-budget
line, White exchanges it with `axb5 axb5`. A deeper search finds the same
lever after `Bxa7` and `Bxf5`. The useful claim concerns the position.
It does not give the whole plan to one exact root move.
[New York game](https://lichess.org/broadcast/2026-fall-nyc-chess-norms/round-7/VdbBeZ4t/un8OTHRJ)

## Compared evidence

1. **Repeated shape.** Two scored candidate lines within 100 centipawns
   show the same pawn advance challenging the same original opposing
   pawn. This ignores whether the plan is used.
2. **Resolved contact.** The original threatened pawn advances within
   three plies, or the original pawns enter a balanced exchange. The
   action must occur in both legal lines, and at least one line shows
   an advance. The same board before the contact would be one
   transposed observation. After resolving contact, both lines must
   remain materially similar.
3. **Resolved contact through recapture.** This finishes successive
   recaptures when the comparison would otherwise stop mid-exchange.
   The advanced original pawn must survive. The fixed two-ply window
   wrongly dropped the New York example at `...Nxe3`, one move before
   `fxe3` restores the previous material balance.

Cached analysis of 1,051 older requests gives 64 repeated shapes and
seven resolved plans. Five previously unclear position reports could
gain an observation. Four have positive position references, and the
Polish example was reviewed as a mistake. The archived notes describe
the same pawn idea in several cases. The Baden note specifically
identifies the g4–h4 contact. In the Puerto Rico team event, the note
also identifies separate tactics near the king. The positional plan
alone does not resolve that tactical question.

## Frozen transfer protocol

The reserve freezes one board per game, at most four of each shape
per event. The actual game determines sampling only. The advance
stratum shows the original opposing pawn advancing after contact.
The other stratum contains another response or unresolved contact.
Prior samples exclude matching game prefixes and colour-normalised
positions where retained. Trial arms receive three Stockfish 19
root choices at 2.4M nodes and a separate 1.4M-node search after
the leader. The reference independently searches four choices at
5.4M nodes and the reply at 3.2M nodes. The actual played move is
not supplied to the position classifier.

The test credits positional support when the deeper lines show
the same original pawns and lever, even if the two close root
moves or their responses change. Exact-move support still needs
its own explanation. A shallow shape with a stable deeper pivot
but no structural outcome is checked separately. A changed root
or lost continuation can leave the case unresolved. Count position
verdicts and agreement on the exact plan separately.

## Transfer result

All 58 games produced complete frames. The independent deeper search
observed five of the scoped plans. The table counts proposed plans by
board. Corroboration means the same lever and original pawns in the
deeper lines. A change of plan at depth leaves the shallow observation
unconfirmed. It does not make the move sequence illegal.

| Root search | Median depth | Repeated shape, found / corroborated | Resolved, found / corroborated | With completed recaptures, found / corroborated |
| --- | ---: | ---: | ---: | ---: |
| Three choices, 2.4M nodes | 20 | 21 / 4 | 5 / 1 | 5 / 1 |
| Four choices, 2.4M nodes | 19 | 24 / 4 | 4 / 1 | 6 / 2 |
| Three choices, 5.4M nodes | 23 | 21 / 3 | 2 / 0 | 3 / 0 |

At the app budget, the only matched plan was already classified as
positional. Black's c4 challenges d3, which advances or is exchanged.
At the same node budget, the four-choice search also finds a5
challenging the original b4 pawn in Çeşme. The deeper lines independently
show both b5 and bxa5. That position had been unclear. The four-choice
arm also proposes four other unconfirmed explanations, and the
three-choice deeper arm recovers none. The trial stays offline.
[Belt and Road game](https://lichess.org/broadcast/2026-belt-and-road-international-chess-open-kuqa-xinjiang-group-b/round-9/33T9A6tw/JipMpye0) ·
[Çeşme game](https://lichess.org/broadcast/12th-cesme-international-open-chess-tournament/round-6/DhWApaGr/D0gaX05O)

To reproduce, run `gather_plans.py engine` from the neighbouring
competing-pawn-plans benchmark with `reserve.json` at the listed settings.
Use 1.4M reply nodes at 2.4M root nodes and 3.2M reply nodes at 5.4M root
nodes. Run `readback.py APP_FRAMES REFERENCE_FRAMES OUTPUT` against the
5.4M-node four-choice reference. The [readback receipt](results.json)
records hashes, costs, the v65 baseline and exact continuations.
