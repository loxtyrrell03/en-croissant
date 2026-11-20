# Pawn advances that dislodge a piece

In the development game, 14.Na4 allows ...b5 with an attack on the
knight. The played comparison and separate reply search both continue
with Nb6. The exchange on c8 briefly changes the material
balance before ...Rxc8 restores it. After the better Rde1, the same
...b5 leaves the original knight on c3 while the queen can enter a7.
The pawn advance has a different effect in the two lines.
[Development game](https://lichess.org/broadcast/44th-bangladesh-national-womens-chess-championship-2026-championship/round-4/e3BffzKo/CA9HFO7f)

The screen follows the piece moved by the recorded choice. It checks
that the opponent's quiet advance makes a new legal attack and that
the same attacked piece moves away on its next turn. The pressing pawn
must stay on its advanced square. The material tally can briefly change
during a same-square recapture. A stricter version also requires the
same push and displacement in a separate search of the played branch.
Its control asks whether that exact push occurs after the better root
without attacking the original piece, which remains on its starting
square. The explanation concerns a different effect of the same pawn
push. An evaluation score alone does not assign the whole loss to it.

The archive and 72-case classical review produced one new candidate,
the Na4 development position. The frozen transfer selects one public
classical position per game. There are 53 games across 30 tournament
groups, with 17 recorded exchanges and 36 moves away. It excludes matching game
prefixes, mirrored boards and the development tournament. The actual
game moves drive selection only. The deeper search and readback check
the exact candidate independently.

## Protocol

Use the broad audit's Stockfish 19 frame capture at 2.4M root nodes and
1.4M reply nodes, then 5.4M and 3.2M for the deeper comparison. Compare
the strict signal with the incumbent on the same inputs. Count an
addition only when the app-budget evidence and separate deeper search
show the same pawn push, same displaced original piece and control.
Record incomplete or different search continuations as unresolved.
Require two verified new explanations on separate event groups before
considering integration.
