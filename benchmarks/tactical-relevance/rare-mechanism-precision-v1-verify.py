"""Independent legal witnesses; no production classifier or engine imported."""
import hashlib
import json
from pathlib import Path
import chess

ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "rare-mechanism-precision-v1-selection.json"
ROWS = {row["id"].split(":")[1]: row for row in json.loads(SELECTION.read_text())["cases"]}
VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}

def material(board, side):
    return sum(VALUES[piece.piece_type] * (1 if piece.color == side else -1) for piece in board.piece_map().values())

def played(board, move):
    move = chess.Move.from_uci(move) if isinstance(move, str) else move
    assert move in board.legal_moves, (board.fen(), move.uci())
    result = board.copy()
    result.push(move)
    return result

def oriented(row, reflected):
    board = chess.Board(row["startFen"])
    return board.mirror() if reflected else board

def move_for(uci, reflected):
    move = chess.Move.from_uci(uci)
    if reflected:
        move = chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion)
    return move

def square_for(name, reflected):
    square = chess.parse_square(name)
    return chess.square_mirror(square) if reflected else square

def settle_captures(board, side, baseline, depth=4):
    """Finite capture/evasion tree. Quiet leaves certify only local material."""
    if board.is_checkmate():
        return 10000 if board.turn != side else -10000
    assert not board.is_stalemate()
    if depth == 0:
        assert not board.is_check()
        return material(board, side) - baseline
    moves = list(board.legal_moves)
    if not board.is_check():
        values = [material(board, side) - baseline]
        moves = [move for move in moves if board.is_capture(move)]
    else:
        values = []
    values.extend(settle_captures(played(board, move), side, baseline, depth - 1) for move in moves)
    return (max if board.turn == side else min)(values)

receipts = []
legal_sources = []
for reflected in (False, True):
    for source in ROWS.values():
        board = oriented(source, reflected)
        for uci in source["bestLine"]:
            board = played(board, move_for(uci, reflected))
        legal_sources.append({"id": source["id"], "reflected": reflected, "plies": len(source["bestLine"])})
    # First root: every actual defence yields a connected capture of the rook,
    # knight or blocker capturer. Recaptures and off-square captures are legal.
    row = ROWS["eAHH6"]
    root = oriented(row, reflected)
    side, baseline = root.turn, material(root, root.turn)
    after = played(root, move_for("g7g8", reflected))
    originals = [square_for(name, reflected) for name in ("e8", "h8")]
    branches = []
    for reply in after.legal_moves:
        next_board = played(after, reply)
        targets = [reply.to_square if reply.from_square == target else target for target in originals]
        candidates = [move for move in next_board.legal_moves if move.to_square in targets and next_board.is_capture(move)]
        gains = [(settle_captures(played(next_board, move), side, baseline), move.uci()) for move in candidates]
        assert gains, reply.uci()
        best = max(gains)
        assert best[0] >= 320, (reply.uci(), gains)
        branches.append({"reply": reply.uci(), "collection": best[1], "localGain": best[0]})
    assert len(branches) == 16
    no_pawn = root.copy()
    no_pawn.remove_piece_at(square_for("h7", reflected))
    refuted = played(played(no_pawn, move_for("g7g8", reflected)), move_for("e8g8", reflected))
    assert not list(refuted.generate_legal_captures())
    assert material(refuted, side) - material(no_pawn, side) == -500
    receipts.append({"id": row["id"], "reflected": reflected, "branches": branches, "guardRemoval": "Removing h7 permits Rxg8+ with no legal recapture; rook loss 500."})

    # Deliberately constructed extra-victim control, not a seventh public case.
    extra = root.copy()
    extra.set_piece_at(square_for("b8", reflected), chess.Piece(chess.KNIGHT, not side))
    assert extra.is_valid()
    extra_start = material(extra, side)
    checked = extra
    for uci in ("g7g8", "e4e3", "g8e8"):
        checked = played(checked, move_for(uci, reflected))
    assert checked.is_check()
    assert checked.is_attacked_by(side, square_for("b8", reflected))
    assert checked.is_attacked_by(side, square_for("h8", reflected))
    additional = []
    for evasion in checked.legal_moves:
        captured_extra = played(played(checked, evasion), move_for("e8b8", reflected))
        gain = settle_captures(captured_extra, side, extra_start)
        assert gain >= 820
        additional.append({"evasion": evasion.uci(), "capture": move_for("e8b8", reflected).uci(), "localGain": gain})
    assert additional
    receipts.append({"id": "constructed:eAHH6-plus-Nb8", "reflected": reflected, "scope": "An actual extra fork victim, not merely a renamed same-target proof. The larger branch gain is not a root minimum.", "extraVictimBranches": additional})

    # Second root: both king evasions block the exact Ra2 -> Ph2 guard.
    row = ROWS["fVyR4"]
    root = oriented(row, reflected)
    side, baseline = root.turn, material(root, root.turn)
    after = played(root, move_for("h6h3", reflected))
    assert {m.uci() for m in after.legal_moves} == {move_for(m, reflected).uci() for m in ("e3f2", "e3e2")}
    branches = []
    for reply in after.legal_moves:
        next_board = played(after, reply)
        pawn = played(next_board, move_for("h3h2", reflected))
        assert pawn.is_check()
        evasions = []
        for evasion in pawn.legal_moves:
            collected = played(played(pawn, evasion), move_for("h2a2", reflected))
            gain = settle_captures(collected, side, baseline)
            assert gain >= 600
            evasions.append({"reply": evasion.uci(), "gain": gain})
        assert evasions
        branches.append({"reply": reply.uci(), "afterPawnCapture": evasions})
    receipts.append({"id": row["id"], "reflected": reflected, "branches": branches})

    row = ROWS["UpwI4"]
    board = oriented(row, reflected)
    defender = not board.turn
    route = []
    for uci in row["bestLine"]:
        move = move_for(uci, reflected)
        if board.turn == defender:
            assert list(board.legal_moves) == [move]
        route.append({"move": move.uci(), "san": board.san(move), "legalRepliesBefore": board.legal_moves.count()})
        board = played(board, move)
    assert board.is_checkmate()
    contrary = oriented(row, reflected)
    contrary.remove_piece_at(square_for("g2", reflected))
    for uci in row["bestLine"]:
        contrary = played(contrary, move_for(uci, reflected))
    assert not contrary.is_checkmate()
    assert move_for("h2g2", reflected) in contrary.legal_moves
    receipts.append({"id": row["id"], "reflected": reflected, "route": route, "escapeControl": "Removing g2 allows Kg2 after the same final rook check; no Anastasia mate."})

print(json.dumps({"schemaVersion": 1, "selectionSha256": hashlib.sha256(SELECTION.read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
    "scope": "Independent python-chess legal finite witnesses, not whole-position evaluations or a population accuracy measure. Captures/evasions close locally; quiet continuations outside these witnesses remain unproved.", "legalSources": legal_sources, "witnesses": receipts}, indent=2))
