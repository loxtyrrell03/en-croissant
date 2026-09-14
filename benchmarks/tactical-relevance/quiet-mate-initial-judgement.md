# Quiet-mate sample: initial chess judgements

Written after legal source replay and before classifier/engine output for this
sample. The nine games were SHA-selected from a fixed 100,000-row prefix of the
official Lichess database, excluding all IDs/games from the prior fixture and
existing benchmarks. Tags nominate distances; they do not certify them.

- **06PHz — Kg3.** The king closes f2, the escape after h2+. The g2 pawn covers
  f1/h1; h2 then mates on g1. White's promotion options must be included. This
  is a mating net, not zugzwang merely because White has only useless moves.
- **0XwFD — Ka6.** Supporting a7 prevents Kxa7 after b7+. The opposite-coloured
  bishop cannot capture the b7 mating pawn. Verify every bishop/pawn reply;
  promotion and ordinary pawn pressure are not the main lesson.
- **0iAUN — Nd3.** Nd3 covers e5, closing the king's escape from Ng3+. The rook
  controls the sixth rank and g-file. A quiet mating net, not an incidental fork.
- **0IJ6I — Rg6.** The rook cuts off g3/g4 before Rh8+. Interposing a rook on
  the h-file delays mate by one capture; do not borrow Rxh5 as a root material win.
- **09Cf3 — Kg3.** King support traps Kh1 before Rb1+. White's rook can interpose
  but cannot save the mating net. Check all rook moves, including checking ideas
  whose paths are blocked by pawns.
- **0hHGN — f6.** The pawn supports Qxg7 mate. Accepting with Bxf6 clears Bh6+;
  ...Bg7 is then met by Qxg7 mate. Mating preparation should lead if all defences
  are covered. The tempting deflection/offer detail needs its own evidence.
- **0z5nl — Kh3.** The king supports g4 and prevents Kh4. The checking pawn
  exchanges and eventual queen capture delay mate; a three-move proof must not
  claim the longer sequence. A quiet king approach with concrete mating intent.
- **0rcU4 — Qh4.** The queen threatens Qe1. Nd3 guards e1; the rook checks and
  exchange on c1 draw the knight away. The later deflection belongs at its actual
  move, not at Qh4. This looks longer than the new three-move proof.
- **0QPvf — Rb8.** The rook supports Qxg8 and the queen exchange on c8.
  ...Rf1+ is a genuine checking resource that adds a king move before the
  back-rank finish. A quiet rook move creating a mating battery; do not declare
  mate in three without covering that countercheck.

The last three are coverage/distance controls, not claimed non-tactical positions.
All initial judgements remain provisional until defensive branches and fresh
engine analysis have been reviewed.
