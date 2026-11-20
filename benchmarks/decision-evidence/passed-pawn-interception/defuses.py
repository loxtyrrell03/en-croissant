"""Check a concrete defence against the same pawn in both stronger lines."""
import chess

from interception import LOOK, material, replay

def defuses(fen, line, origin, window):
    initial=chess.Board(fen)
    frames=replay(initial,line)
    if not frames:
        return None
    defender=initial.turn
    for index, step in enumerate(frames[:window]):
        move=step.move
        if (
            move is None
            or step.board.turn != defender
            or step.pieces.get(move.to_square) != origin
            or not step.board.is_capture(move)
        ):
            continue
        square=move.to_square
        # Finish the same-square exchange and allow one subsequent reply.
        # The pawn can have promoted before its original identity is removed.
        through=index+1
        while through<len(frames)-1 and through<=index+4 and frames[through].move.to_square==square:
            through+=1
        if through>=len(frames)-1 or frames[through].move.to_square==square:
            return None
        settled=frames[through].board
        before=material(step.board,defender)
        immediate=material(settled,defender)-before
        subsequent=material(frames[through+1].board,defender)-before
        if min(immediate,subsequent)<0:
            return None
        return dict(move=step.san,ply=index+1,through=through,material=immediate)
    return None

def paired_defence(fen, witness):
    origin=chess.parse_square(witness["sacrifice"]["origin"])
    through=max(witness["sacrifice"]["end"],witness["repeat"]["end"])+2
    defences=[defuses(fen,witness[key],origin,min(through,LOOK))
              for key in ("better","betterIndependent")]
    return defences if all(defences) else None
