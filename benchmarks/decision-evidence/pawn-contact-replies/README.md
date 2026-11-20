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
seven resolved plans. Five of those seven were previously unclear and
all seven already have positive positional reference labels. These
are retrospective axis counts. The reference notes are checked for
agreement with the specific proposed plan during readback.

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
