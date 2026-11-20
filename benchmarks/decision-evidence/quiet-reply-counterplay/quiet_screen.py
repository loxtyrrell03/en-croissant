import chess
from collections import Counter
from pathlib import Path
import sys
import json

VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def legal_next(board, move, actor):
    pos = board.copy(stack=False)
    pos.turn = actor
    return pos.is_legal(move)


def threat_targets(board, root):
    actor = board.turn
    piece = board.piece_at(root.from_square)
    if piece.piece_type == chess.KING or root.promotion or board.is_capture(root) or board.gives_check(root):
        return {}
    after = board.copy(stack=True)
    after.push(root)
    return {
        dest: after.piece_at(dest)
        for dest in after.attacks(root.to_square) - board.attacks(root.from_square)
        if (target := after.piece_at(dest)) and target.color != actor
        and VALUES[target.piece_type] - VALUES[piece.piece_type] >= 100
        and legal_next(after, chess.Move(root.to_square, dest), actor)
    }


def quiet_roles(before, root, reply, target):
    actor = not before.turn
    if (before.is_capture(reply) or before.gives_check(reply)
            or reply.promotion or reply.from_square == target):
        return None
    after = before.copy(stack=True)
    after.push(reply)
    if not legal_next(after, chess.Move(reply.to_square, root.to_square), not actor):
        return None
    attempt = chess.Move(root.to_square, target)
    if attempt not in after.legal_moves:
        return "interpose" if reply.to_square in chess.SquareSet(chess.between(root.to_square, target)) else None
    take = after.copy(stack=False)
    take.push(attempt)
    if chess.Move(reply.to_square, target) not in take.legal_moves:
        return None
    prior = before.copy(stack=False)
    prior.turn = actor
    prior.push(attempt)
    return "switch" if chess.Move(reply.from_square, target) not in prior.legal_moves else None


def snapshot(board, color):
    return sum(VALUES[p.piece_type] * (1 if p.color == color else -1) for p in board.piece_map().values())


def outcome(reached, reply, pv, root, target, role):
    actor = not reached.turn
    after = reached.copy(stack=True)
    after.push(reply)
    answer = after.parse_uci(pv[0])
    if (role == "interpose" and answer.from_square != root.to_square and after.gives_check(answer)
            and reply.from_square in chess.SquareSet(chess.between(answer.from_square, answer.to_square))
            and not legal_next(reached, answer, actor)):
        return "opened-check"
    tracked = target
    capture_index = None
    pre = snapshot(after, actor)
    balance = []
    for i, uci in enumerate(pv[:12]):
        move = after.parse_uci(uci)
        if tracked is not None:
            if move.to_square == tracked and after.is_capture(move) and after.turn == actor:
                capture_index = i
                break_index = i + 3
                tracked = None
            elif move.from_square == tracked:
                tracked = move.to_square
        after.push(move)
        balance.append(snapshot(after, actor) - pre)
        if capture_index is not None and i >= break_index:
            if min(balance[i - 2:i + 1]) >= 140:
                return "material"
            break
    return None


def scan(row):
    roots = row.get("candidates", [])
    if not roots:
        return []
    board = chess.Board(row["fen"])
    result = []
    for best in roots:
        if best["cp"] is None or best.get("mate") is not None or best["depth"] < 16:
            continue
        root = board.parse_uci(best["pvUci"][0])
        targets = threat_targets(board, root)
        if not targets:
            continue
        probe = next((p for p in row.get("replyProbes", []) if p["moveUci"] == root.uci()), {})
        reply_lines = probe.get("lines", [])
        if len(reply_lines) < 2:
            continue
        top = reply_lines[0]
        if top["cp"] is None or top["depth"] < 16 or abs(best["cp"] + top["cp"]) > 90:
            continue
        after = board.copy(stack=True)
        after.push(root)
        for line in reply_lines[1:]:
            if line["cp"] is None or line["depth"] != top["depth"] or top["cp"] - line["cp"] < 100 or len(line["pvUci"]) < 4:
                continue
            reply = after.parse_uci(line["pvUci"][0])
            for target in targets:
                role = quiet_roles(after, root, reply, target)
                if role:
                    kind = outcome(after, reply, line["pvUci"][1:], root, target, role)
                    result.append(dict(id=row["id"], fen=row["fen"], move=root.uci(), reply=reply.uci(),
                                       target=chess.square_name(target), role=role, kind=kind,
                                       line=after.variation_san([chess.Move.from_uci(x) for x in line["pvUci"][:9]]),
                                       gap=top["cp"]-line["cp"]))
    return result


if __name__ == "__main__":
    for filename in sys.argv[1:]:
        rows = json.loads(Path(filename).read_bytes())
        events = [event for row in rows for event in scan(row)]
        print(Path(filename).name, len(rows), Counter((x["role"],x["kind"]) for x in events),flush=True)
        for x in events:
            print(x)
