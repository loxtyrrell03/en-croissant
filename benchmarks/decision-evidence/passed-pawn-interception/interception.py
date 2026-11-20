"""Legally replay the identity and liquidation of an advanced pawn."""
from dataclasses import dataclass
import chess

PIECE_VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
               chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}
LOOK = 12

@dataclass
class Step:
    board: chess.Board
    move: chess.Move
    san: str
    pieces: dict

def relative_rank(color, square):
    rank = chess.square_rank(square)
    return rank + 1 if color else 8 - rank

def passed(board, color, square):
    return not any(
        abs(chess.square_file(enemy) - chess.square_file(square)) <= 1
        and relative_rank(color, enemy) > relative_rank(color, square)
        for enemy in board.pieces(chess.PAWN, not color)
    )

def material(board, perspective):
    return sum(
        value * (len(board.pieces(role, perspective)) - len(board.pieces(role, not perspective)))
        for role, value in PIECE_VALUE.items()
    )

def replay(board, moves):
    board = board.copy(stack=True)
    squares = {square: square for square in board.piece_map()}
    result = []
    for uci in moves[:LOOK + 7]:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return []
        result.append(Step(board.copy(stack=True), move, board.san(move), squares.copy()))
        mover = squares.pop(move.from_square, None)
        if board.is_en_passant(move):
            squares.pop(move.to_square + (-8 if board.turn else 8), None)
        if board.is_castling(move):
            nr = board.king(board.turn) >> 3
            short = board.is_kingside_castling(move)
            rook = squares.pop(nr*8 + (7 if short else 0), None)
            squares[nr*8 + (5 if short else 3)] = rook
        squares[move.to_square] = mover
        board.push(move)
    result.append(Step(board, None, None, squares))
    return result

def losses(board, line):
    defender = board.turn
    attacker = not defender
    result = []
    for index in range(2, min(len(line) - 2, LOOK), 2):
        step = line[index]
        take = step.move
        square = take.to_square
        if (
            relative_rank(attacker, square) != 7
            or step.board.piece_at(square) != chess.Piece(chess.PAWN, attacker)
            or not passed(step.board, attacker, square)
            or step.board.piece_type_at(take.from_square) in (chess.PAWN, chess.KING)
        ):
            continue
        origin = step.pieces.get(square)
        if origin is None or board.piece_at(origin) != chess.Piece(chess.PAWN, attacker):
            continue
        if relative_rank(attacker, origin) < 5 or not passed(board, attacker, origin):
            continue
        end = index + 1
        while end < len(line) - 1 and end <= index + 3 and line[end].move.to_square == square:
            end += 1
        # The recapture must take the original interceptor. Unrelated later losses
        # do not count, and taking it back may restore the material balance.
        if end <= index + 1:
            continue
        cost = material(step.board, defender) - material(line[end].board, defender)
        if cost < 65:
            continue
        if any(
            tail.board.turn == defender
            and tail.move is not None
            and tail.move.to_square == square
            for tail in line[end:end+1]
        ):
            continue
        result.append({
            "origin": chess.square_name(origin),
            "square": chess.square_name(square),
            "interceptor": chess.piece_name(step.board.piece_type_at(take.from_square)),
            "cost": cost,
            "index": index,
            "end": end,
            "fen": step.board.fen(),
            "indexSan": step.san,
            "actual": [s.move.uci() for s in line[:end]],
            "prefixSan": [s.san for s in line[:index]],
            "exchangeSan": [s.san for s in line[index:end]],
        })
    return result

def pair(row):
    choices = row.get("comparisonCandidates") or []
    if len(choices) != 2 or choices[1]["pvUci"][0] != row.get("playedMoveUci"):
        return
    best, played = choices
    if (best.get("cp") is None or played.get("cp") is None or
            best["depth"] != played["depth"] or best["cp"] - played["cp"] < 80):
        return
    probes = {p["moveUci"]: p["lines"][0] for p in row.get("replyProbes", []) if p["lines"]}
    independent = [probes.get(choice["pvUci"][0]) for choice in choices]
    if not all(
        reply and reply.get("cp") is not None and abs(choice["cp"] + reply["cp"]) <= 120
        for choice, reply in zip(choices, independent)
    ) or independent[1]["cp"] - independent[0]["cp"] < 65:
        return
    board = chess.Board(row["fen"])
    paths = [moves for choice, reply in zip(choices, independent)
             for moves in (choice["pvUci"], [choice["pvUci"][0], *reply["pvUci"]])]
    trails = [replay(board, path) for path in paths]
    if not all(trails):
        return
    return board, choices, independent, paths, trails

def examples(row):
    paired = pair(row)
    if not paired:
        return []
    board, choices, independent, paths, trails = paired
    lists = [losses(board, trace) for trace in trails]
    def key(found):
        return found["origin"], found["square"], found["interceptor"]
    seen = [{key(witness): witness for witness in matches} for matches in lists]
    out = []
    for sig in set(seen[2]) & set(seen[3]) - set(seen[0]) - set(seen[1]):
        first, second = seen[2][sig], seen[3][sig]
        out.append({
            "id": row["id"],
            "betterUci": choices[0]["pvUci"][0],
            "playedUci": choices[1]["pvUci"][0],
            "sacrifice": first,
            "repeat": second,
            "better": paths[0][:LOOK],
            "betterIndependent": paths[1][:LOOK],
        })
    return out
