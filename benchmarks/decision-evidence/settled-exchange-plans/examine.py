"""Screen settled exchanges for concrete, corroborated pawn and rook plans."""
import argparse
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "neural-passer-probe"))
from assets import passed, relative_rank

MAX_PLY = 14
VALUES = (0, 100, 320, 330, 500, 900, 0)
SOURCES = (
    "reply-coverage-audit/full-pair-input.json",
    "current-classifier-audit/matched-early.json",
    "current-classifier-audit/prospective-scored.json",
    "reply-concordance/reserve-scored.json",
    "alternate-capture-payoff/fresh-scored.json",
    "promotion-check-tempo/fresh-scored.json",
)


@dataclass
class Step:
    board: chess.Board
    uci: str
    move: chess.Move
    actor: int
    role: int
    removed: int | None
    balance: int
    identities: dict
    forcing: bool


def traced(root, moves):
    board, color = root.copy(), root.turn
    identities = {square: square for square in board.piece_map()}
    balance = 0
    steps = []
    for uci in moves[:MAX_PLY]:
        if board.is_game_over(claim_draw=False):
            return []
        move = board.parse_uci(uci)
        if not move or board.is_castling(move):
            return []
        victim = move.to_square
        if board.is_en_passant(move):
            victim -= 8 if board.turn else -8
        actor = identities.pop(move.from_square)
        role = board.piece_type_at(move.from_square)
        removed = identities.pop(victim, None)
        taken = VALUES[board.piece_type_at(victim)] if removed is not None else 0
        growth = VALUES[move.promotion] - 100 if move.promotion else 0
        balance += (taken + growth) * (1 if board.turn == color else -1)
        board.push(move)
        identities[move.to_square] = actor
        steps.append(Step(board.copy(), uci, move, actor, role, removed, balance,
                          dict(identities), bool(removed is not None or move.promotion or board.is_check())))
    return steps


def settlement(steps):
    involved = False
    victims = set()
    origin = steps[0].actor
    for i, step in enumerate(steps[:6]):
        if step.removed is None:
            continue
        if i >= 4 and not victims:
            return None
        involved |= step.actor == origin or step.removed == origin
        victims.add(step.removed)
        if len(victims) < 2 or not involved or not -50 <= step.balance <= 50:
            continue
        later = steps[i + 1:i + 3]
        if (len(later) == 2 and not any(ply.forcing for ply in later)
                and not any(ply.move.promotion for ply in steps[:i + 1])):
            return i, victims
    return None


def stays(steps, index, asset, role, color, plies):
    if len(steps) <= index + plies:
        return False
    for later in steps[index:index + plies + 1]:
        piece_square = next((square for square, identity in later.identities.items() if identity == asset), None)
        if piece_square is None:
            return False
        if later.board.piece_type_at(piece_square) != role or later.board.color_at(piece_square) != color:
            return False
    return True


def on_file(position, piece_type, color, file):
    return any(chess.square_file(square) == file for square in position.pieces(piece_type, color))


def features(root, steps, settled):
    index, victims = settled
    color, level = root.turn, steps[index]
    board = level.board
    features = {}
    for square in board.pieces(chess.PAWN, color):
        origin = level.identities[square]
        if (
            root.piece_type_at(origin) != chess.PAWN or passed(root, origin, color)
            or relative_rank(square, color) < 3 or not passed(board, square, color)
        ):
            continue
        used = next((
            (i, step) for i, step in enumerate(steps[index + 1:index + 7], index + 1)
            if step.actor == origin and not step.forcing and relative_rank(step.move.to_square, color) >= 4
            and passed(step.board, step.move.to_square, color)
            and stays(steps, i, origin, chess.PAWN, color, 4)
        ), None)
        features[f"pawn:{chess.square_name(origin)}"] = {
            "actor": chess.square_name(origin), "square": chess.square_name(square), "formedAt": index + 1,
            "uses": used[1].uci if used else None, "usedAt": used[0] + 1 if used else None,
        }
    for file in range(8):
        if not on_file(root, chess.PAWN, color, file) or on_file(board, chess.PAWN, color, file):
            continue
        rooks = list(board.pieces(chess.ROOK, color))
        if not rooks:
            continue
        used = None
        for i, step in enumerate(steps[index + 1:index + 7], index + 1):
            target = step.move.to_square
            if (
                root.color_at(step.actor) != color or step.role != chess.ROOK or step.forcing
                or chess.square_file(target) != file
                or (chess.square_file(step.move.from_square) == file
                    and relative_rank(target, color) <= relative_rank(step.move.from_square, color))
                or on_file(step.board, chess.PAWN, color, file)
                or not stays(steps, i, step.actor, chess.ROOK, color, 2)
            ):
                continue
            attacks = [
                square for square in step.board.attacks(target)
                if chess.square_file(square) == file and step.board.color_at(square) == (not color)
            ]
            if relative_rank(target, color) < 4 and not attacks:
                continue
            used = i, step
            break
        features[f"file:{chess.FILE_NAMES[file]}"] = {
            "actor": chess.square_name(used[1].actor) if used else None,
            "formedAt": index + 1, "uses": used[1].uci if used else None,
            "usedAt": used[0] + 1 if used else None,
        }
    return {key: dict(value, victims=sorted(map(chess.square_name, victims))) for key, value in features.items()}


def exact(line, board):
    return (
        line.get("cp") is not None and line.get("mate") is None and line.get("depth", 0) >= 16
        and not line.get("lowerbound") and not line.get("upperbound") and line["fen"] == board.fen()
    )


def evaluate(row):
    root = chess.Board(row["fen"])
    if row.get("history"):
        root = chess.Board(row["history"]["fen"])
        for uci in row["history"]["moves"]:
            root.push_uci(uci)
        if root.fen() != row["fen"]:
            return []
    roots = row.get("candidates") or []
    if not roots or not exact(roots[0], root):
        return []
    probes = {entry["moveUci"]: entry["lines"] for entry in row.get("replyProbes", []) if entry["lines"]}
    results = []
    for line in roots[:3]:
        if (
            not exact(line, root) or line["depth"] != roots[0]["depth"] or roots[0]["cp"] - line["cp"] > 50
            or not line["pvUci"] or line["pvUci"][0] not in probes
        ):
            continue
        choice = line["pvUci"][0]
        child = root.copy()
        child.push_uci(choice)
        response = probes[choice][0]
        if not exact(response, child) or abs(line["cp"] + response["cp"]) > 90:
            continue
        try:
            left = traced(root, line["pvUci"])
            right = traced(root, [choice, *response["pvUci"]])
        except ValueError:
            continue
        if not left or not right or not (a := settlement(left)) or not (b := settlement(right)):
            continue
        proposed, confirmed = features(root, left, a), features(root, right, b)
        for key in sorted(proposed.keys() & confirmed.keys()):
            one, two = proposed[key], confirmed[key]
            used = bool(one["uses"] and two["uses"])
            results.append({
                "move": choice, "asset": key, "used": used,
                "linked": used and one["actor"] == two["actor"] and one["victims"] == two["victims"],
                "paired": one, "independent": two,
                "pairedLine": line["pvUci"][:MAX_PLY], "independentLine": [choice, *response["pvUci"]][:MAX_PLY],
            })
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("lab", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--explicit", type=Path)
    args = p.parse_args()
    sources = (args.explicit,) if args.explicit else tuple(args.lab / relative for relative in SOURCES)
    result = {}
    for file in sources:
        raw = file.read_bytes()
        rows = json.loads(raw)
        counts, cases = Counter(), []
        for row in rows:
            if found := evaluate(row):
                counts["geometry"] += 1
                counts["used"] += any(item["used"] for item in found)
                counts["linked"] += any(item["linked"] for item in found)
                cases.append({key: row.get(key) for key in ("id", "fen", "site", "label")} | {"effects": found})
        name = file.name if args.explicit else file.relative_to(args.lab).as_posix()
        result[name] = {"count": len(rows), "counts": dict(counts), "cases": cases,
                        "sha256": sha256(raw).hexdigest()}
        print(name, len(rows), dict(counts), flush=True)
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main()
