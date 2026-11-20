"""Screen legal examples of a pawn advance driving away a piece."""
import argparse
from collections import Counter
import json
from pathlib import Path

import chess

WINDOW = 12
VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500, chess.QUEEN: 900}


def read(path):
    return json.loads(path.read_bytes())


def finite(line):
    return (line.get("mate") is None and isinstance(line.get("cp"), int) and
            line["depth"] >= 16 and not line.get("claimHistory"))


def material(board, side):
    return sum(v * (len(board.pieces(p, side)) - len(board.pieces(p, not side))) for p, v in VALUES.items())


def replay(root, pv):
    board = root.copy(stack=False)
    steps = []
    for uci in pv[:WINDOW]:
        move = chess.Move.from_uci(uci)
        if not board.is_legal(move) or board.is_game_over():
            return []
        text = board.san(move)
        before = board.copy(stack=False)
        board.push(move)
        steps.append((before, move, board.copy(stack=False), text))
    return steps


def same_piece(board, square, piece):
    return board.piece_at(square) == piece


def observations(root, pv, focus, piece):
    events = []
    steps = replay(root, pv)
    for index, (before, move, after, san) in enumerate(steps[1:7], 1):
        if not same_piece(before, focus, piece):
            break
        if before.turn == root.turn or before.is_capture(move) or before.gives_check(move) or move.promotion:
            continue
        pawn = before.piece_at(move.from_square)
        if pawn is None or pawn.piece_type != chess.PAWN or focus not in after.attacks(move.to_square):
            continue
        if focus in before.attacks(move.from_square):
            continue
        threat = after.copy(stack=False)
        threat.turn = before.turn
        threat.ep_square = None
        take = chess.Move(move.to_square, focus)
        if not threat.is_legal(take):
            continue
        tail = steps[index + 1:index + 5]
        if len(tail) != 4:
            continue
        withdrawal = tail[0]
        recovery = any(m.to_square == focus for _, m, _, _ in tail[1:])
        if withdrawal[1].from_square != focus or withdrawal[0].is_capture(withdrawal[1]) or recovery:
            continue
        initial = material(root, root.turn)
        settled = True
        for j, (p, tm, a, _) in enumerate(tail):
            if not same_piece(a, move.to_square, pawn):
                settled = False
                break
            if abs(material(a, root.turn) - initial) > 100:
                next_move = tail[j + 1][1] if j + 1 < len(tail) else None
                if not p.is_capture(tm) or not next_move or next_move.to_square != tm.to_square or not a.is_capture(next_move):
                    settled = False
                    break
        if not settled:
            continue
        events.append(dict(pawn=move.uci(), pawnSan=san, target=chess.square_name(focus),
                           displaced=withdrawal[3], witness=[s[3] for s in steps[:index + 5]],
                           uci=pv[:index + 5], through=index + 5))
    return events


def examine(row):
    actual = row.get("playedMoveUci")
    if not actual:
        return []
    roots = row.get("comparisonCandidates") or row["candidates"]
    played = next((line for line in roots if line["pvUci"][0] == actual), None)
    if not played or not finite(played) or not roots or played is roots[0] or not finite(roots[0]):
        return []
    better = roots[0]
    if played["depth"] != better["depth"] or better["cp"] - played["cp"] < 55:
        return []
    board = chess.Board(row["fen"])
    root = chess.Move.from_uci(actual)
    mover = board.piece_at(root.from_square)
    if (not mover or mover.piece_type not in (chess.KNIGHT, chess.BISHOP, chess.ROOK) or
            not board.is_legal(root) or board.is_capture(root) or board.gives_check(root)):
        return []
    hits = observations(board, played["pvUci"], root.to_square, mover)
    if not hits:
        return []
    probes = next((p["lines"] for p in row.get("replyProbes", []) if p["moveUci"] == actual), [])
    direct = probes[0] if probes and finite(probes[0]) and abs(probes[0]["cp"] + played["cp"]) <= 90 else None
    other = observations(board, [actual, *direct["pvUci"]], root.to_square, mover) if direct else []
    improved = replay(board, better["pvUci"])
    for event in hits:
        event["twice"] = any(match["pawn"] == event["pawn"] for match in other)
        event["alternate"] = [step[3] for step in improved[:event["through"]]]
        event["samePush"] = any(step[1].uci() == event["pawn"] for step in improved[:event["through"]])
        for before, move, after, _ in improved[:event["through"]]:
            if (move.from_square == root.from_square or move.to_square == root.from_square):
                break
            if move.uci() == event["pawn"]:
                event["cleanControl"] = (same_piece(before, root.from_square, mover) and
                                          root.from_square not in after.attacks(move.to_square))
                break
    return hits


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    hits = []
    counts = Counter()
    for row in read(args.input):
        events = examine(row)
        if events:
            hits.append({"id": row["id"], "label": row.get("label"), "events": events})
            counts[row["id"].split("#", 1)[0]] += 1
    print(dict(counts), flush=True)
    with args.output.open("x", encoding="utf8", newline="\n") as output:
        json.dump(hits, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
