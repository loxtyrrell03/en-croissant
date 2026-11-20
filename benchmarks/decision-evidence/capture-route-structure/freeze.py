"""Freeze classical decisions about taking the same piece with or without a pawn."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re

import chess.pgn


def digest(data):
    return sha256(data).hexdigest()


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def quiet_check(board, move):
    return (board.piece_type_at(move.from_square) not in {chess.PAWN, chess.KING}
            and not board.is_capture(move) and board.gives_check(move))


def pawn_captures(board):
    for move in board.generate_legal_captures(from_mask=board.pieces_mask(chess.PAWN, board.turn)):
        if board.piece_type_at(move.to_square) in {chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN}:
            yield move


def capture_target(board, check, reply, take):
    """Locate the original target, including a defender who interposes with it."""
    first = board.copy(stack=False)
    first.push(check)
    if not first.is_legal(reply) or first.is_castling(reply) or reply.promotion:
        return None
    first.push(reply)
    if (not first.is_legal(take) or not first.is_capture(take)
            or first.piece_type_at(take.from_square) in {chess.PAWN, chess.KING}):
        return None
    return reply.from_square if take.to_square == reply.to_square else take.to_square


def potential_same_target(board, check, target):
    first = board.copy(stack=False)
    first.push(check)
    for reply in first.legal_moves:
        if first.is_castling(reply) or reply.promotion or reply.to_square == target:
            continue
        victim = reply.to_square if reply.from_square == target else target
        first.push(reply)
        captures = list(first.generate_legal_captures(
            from_mask=first.occupied_co[first.turn] & ~(first.pawns | first.kings),
            to_mask=chess.BB_SQUARES[victim],
        ))
        first.pop()
        if captures:
            return True
    return False


def choices(board, moves):
    played, reply, follow = moves
    direct = list(pawn_captures(board))
    if not direct:
        return []
    if quiet_check(board, played):
        target = capture_target(board, played, reply, follow)
        return [(played.uci(), move.uci()) for move in direct if move.to_square == target]
    if played not in direct:
        return []
    return [(check.uci(), played.uci()) for check in board.legal_moves
            if quiet_check(board, check) and potential_same_target(board, check, played.to_square)]


def collect(paths):
    cases, source = {}, {}
    for path in paths:
        selected = 0
        with path.open(encoding="utf-8-sig") as stream:
            while game := chess.pgn.read_game(stream):
                site = game.headers.get("Site", "")
                match = re.fullmatch(r"https://lichess\.org/broadcast/([^/]+)/[^/]+/[^/]+/([A-Za-z0-9]{8})", site)
                if (game.errors or match is None or game.board().chess960
                        or game.headers.get("Variant", "Standard") != "Standard"
                        or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}):
                    continue
                event, game_id = match.groups()
                key = re.sub(r"(?:-open-section|-open|-women|-section-[a-z]|-masters)$", "", event)
                board = game.board()
                initial = board.fen()
                moves = list(game.mainline_moves())
                ucis = [move.uci() for move in moves]
                for i, move in enumerate(moves):
                    if 19 <= i < min(119, len(moves) - 2):
                        pairs = choices(board, moves[i:i+3])
                        if pairs:
                            selected += 1
                            mark = digest(f"capture-route-v1:{game_id}:{i}".encode())[:20]
                            cases[mark] = dict(
                                id=mark, game=game_id, event=key, site=site, fen=board.fen(),
                                playedMoveUci=ucis[i], observed=ucis[i:i+3], pairs=pairs,
                                mode="check-first" if pairs[0][0] == ucis[i] else "pawn-first",
                                history=dict(fen=initial, moves=ucis[:i]),
                            )
                    board.push(move)
        source[path.name] = dict(sha256=digest(path.read_bytes()), nominations=selected)
    return cases, source


def choose(candidates, used_games, used_boards, limit):
    result = []
    for mode in ("check-first", "pawn-first"):
        group = []
        for row in sorted(candidates.values(), key=lambda item: item["id"]):
            if row["mode"] != mode or row["game"] in used_games:
                continue
            key = board_key(chess.Board(row["fen"]))
            if key in used_boards:
                continue
            used_games.add(row["game"])
            used_boards.add(key)
            group.append(row)
            if len(group) == limit:
                break
        result.extend(group)
    return result


def write(path, data):
    with path.open("x", encoding="utf8", newline="\n") as out:
        json.dump(data, out, indent=2)
        out.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--development", type=Path, nargs="+", required=True)
    parser.add_argument("--reserve", type=Path, nargs="+", required=True)
    parser.add_argument("--per-mode", type=int, default=24)
    args = parser.parse_args()
    if args.per_mode < 1:
        parser.error("Expected at least one game per mode")
    development, dev_sources = collect(args.development)
    reserve, reserve_sources = collect(args.reserve)
    reserve_events = {row["event"] for row in reserve.values()}
    used_games, used_boards = set(), set()
    dev = choose({key: row for key, row in development.items() if row["event"] not in reserve_events},
                 used_games, used_boards, args.per_mode)
    test = choose(reserve, used_games, used_boards, args.per_mode)
    write(args.output, dict(development=dev, reserve=test))
    write(args.output.with_suffix(".manifest.json"), dict(
        development=dev_sources, reserve=reserve_sources,
        selectionSha256=digest(args.output.read_bytes()), perMode=args.per_mode,
        selected=[dict(Counter(row["mode"] for row in split)) for split in (dev, test)],
        events=[sorted({row["event"] for row in split}) for split in (dev, test)],
    ))
    print(len(dev), len(test), Counter(row["mode"] for row in dev), Counter(row["mode"] for row in test))


if __name__ == "__main__":
    main()
