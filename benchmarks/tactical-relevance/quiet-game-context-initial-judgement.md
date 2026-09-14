# Four new source-game contexts: initial chess judgements

Recorded from legal game boards/source moves before fresh engine or classifier
output. Fixed mixed-colour plies give 21 positions; three unavailable plies are
not replaced. The previously inspected puzzle endpoints do not make these
unexamined game positions correct negatives. These are puzzle-source games,
not representative ordinary-game accuracy data.

## TRKE6TxS

- **Ply 7, ...Nxe4:** a normal Petroff recovery of the previously captured e-pawn.
  White's knight just retreated from e5. A locally loose pawn is not necessarily
  a new tactical mistake; the opening's earlier exchange matters here.
- **Ply 22, Rad1:** ordinary rook development behind Qd2. The bishops and central
  pawns invite exchanges, not a demonstrated pin/fork or direct winning attack.
- **Ply 41, ...Ke8:** centralising the king in a four-bishop ending. No immediate
  loose-piece capture is apparent. Mobility or restricted bishops alone do not
  establish a trap or zugzwang.
- **Ply 60, c5+:** a checking pawn advance in a blocked bishop ending. The later
  bishop trade changes the pawn race; ...e4 and ...g4 then aim to break through.
  That future race is not yet proof of a tactic on c5. Check alternatives and
  whether the bishop exchange itself is an error.
- **Ply 81, ...bxa6:** an exchange in a sharp pawn ending with ...g2/h3 and distant
  white passers. The supplied line eventually permits ...Kg3 mate, but White has
  king-escape choices before then. Do not borrow the known puzzle endpoint or
  call this zugzwang without comparing legal alternatives to passing.

## Gectvn7R

- **Ply 7, ...e6:** normal central support/development in a Queen's Gambit/Slav
  structure. No concrete tactical mechanism is apparent.
- **Ply 22, Bb5:** a normal developing pin of Nc6 to Ke8. A geometrical pin is
  present, but no forced material gain has been shown. The queen loss much later
  after ...Qc7/Rc1 must not be attributed to this bishop development.
- **Ply 41, ...Bd6:** saves Be5 from Nf3 while improving coordination. The unusual
  queen-versus-pieces balance is already owned, not a new material tactic.
- **Ply 60, Rd1:** rook activity against d5, with ...d4 available to advance the
  pawn into the rook's protection. Pressure on an initially loose pawn is not
  automatically a forced material win.
- **Ply 81, ...Bf6:** ...Rc3 after Qxd3 pins the queen to Kf3; that mechanism belongs
  on the later rook move. Qxd3 is not compulsory. Determine whether ...Bf6 itself
  forces anything or is just a waiting/improving move beside an advanced pawn.
- **Ply 100, gxf5:** an immediate pawn recapture. The queenside passers are important
  strategically, but a later mating pawn advance does not make this recapture a
  promotion combination or zugzwang.

## ZFgq8VzD

- **Ply 7, ...Bb4:** a developing pin in the Danish Gambit structure. Nc3 is pinned
  to Ke1, but the present bishop move is not shown to force a material win.
- **Ply 22, bxc3:** recaptures the bishop that just took Nc3. The ten-centipawn
  nominal bishop/knight difference is not a free bishop. The uncastled black king
  may allow other tactics; inspect the best alternative rather than assuming none.
- **Ply 41, ...Qc5+:** a checking queen exchange, with ...Nxc5 answering Qxc5. The
  extra black piece already exists; a later knight check or rook capture should
  not become the initial queen move's tactical explanation.
- **Ply 60, Kf5:** a king evasion from ...Rxg2+. The later ...Rg6 and ...Nd3 mating
  net depends on subsequent choices; Ke5 appears to be an escape before the net
  closes. Being materially worse already must not be blamed on this king move
  without an independently evaluated alternative.

## C9q6jvtW

- **Ply 7, ...Nf6:** normal development and knight exchange in the Caro-Kann.
  Nxf6/exf6 is not a newly hanging knight or a tactical pawn win.
- **Ply 22, Bxd4:** recovers the just-captured d-pawn. The later ...Rb8 vacates a7's
  rook defence, but that does not make the current equal recapture a new tactic.
- **Ply 41, ...fxg4:** recaptures a knight that just took Black's knight. The
  resulting pawn structure changes, but this is not a free minor piece.
- **Ply 60, Rdb1:** supports queenside passers in a double-rook ending. Black can
  centralise the king; no immediate fork, trap or forced material gain is clear.
- **Ply 81, ...Kd5:** evades the d-pawn's check. King movement under check is not
  zugzwang. The locked a-file and mobile kings require ending judgement, not a
  future mate badge.
- **Ply 100, b6+:** advances a passer with tempo in an already favourable rook
  ending. Ke5 can also protect d4 and attack the rook. No forced material motif
  is established merely by the check or by the rook's subsequent retreat.

These are provisional explanatory judgements, not expected-output labels.
Fresh engine lines and actual resulting boards will challenge them before any
regression expectation or production change is accepted.
