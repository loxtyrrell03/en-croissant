"""Freeze standard classical decisions where a player can castle immediately."""

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


def outcome(board, sequence):
    """Use the game to sample consequences and leave their meaning to review."""
    work = board.copy(stack=False)
    work.push(sequence[0])
    for index, move in enumerate(sequence[1:], 1):
        if index % 2 == 0:
            if work.is_castling(move):
                return "castled-later"
            if work.piece_type_at(move.from_square) == chess.KING:
                return "checked-king-move" if work.is_check() else "quiet-king-move"
        work.push(move)
    return None


def collect(paths):
    items, manifest = {}, {}
    for path in paths:
        total = 0
        with path.open(encoding="utf-8-sig") as stream:
            while game := chess.pgn.read_game(stream):
                site = game.headers.get("Site", "")
                parsed = re.fullmatch(r"https://lichess\.org/broadcast/([^/]+)/[^/]+/[^/]+/([A-Za-z0-9]{8})", site)
                if (game.errors or not parsed or game.board().chess960
                        or game.headers.get("Variant", "Standard") != "Standard"
                        or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}):
                    continue
                event, game_id = parsed.groups()
                event = re.sub(r"(?:-open-section|-open|-women|-section-[a-z]|-masters)$", "", event)
                board = game.board()
                origin = board.fen()
                moves = list(game.mainline_moves())
                replay = [move.uci() for move in moves]
                for index, move in enumerate(moves):
                    if 12 <= index < min(49, len(moves) - 4) and not board.is_capture(move):
                        castles = list(board.generate_castling_moves())
                        role = board.piece_type_at(move.from_square)
                        if castles and role not in {chess.KING, chess.ROOK}:
                            observed = outcome(board, moves[index:index + 5])
                            if observed:
                                mark = digest(f"castling-delay-v1:{game_id}:{index}".encode())[:20]
                                items[mark] = dict(
                                    id=mark, game=game_id, event=event, site=site, fen=board.fen(),
                                    playedMoveUci=move.uci(), castles=[m.uci() for m in castles],
                                    observed=replay[index:index+5], shape=observed,
                                    history=dict(fen=origin, moves=replay[:index]),
                                )
                                total += 1
                    board.push(move)
        entry = dict(sha256=digest(path.read_bytes()), nominations=total)
        if path.name in manifest and manifest[path.name] != entry:
            raise ValueError(f"Ambiguous source filename {path.name}")
        manifest[path.name] = entry
    return items, manifest


def selection(rows, games, boards, cap):
    result = []
    for shape in ("checked-king-move", "quiet-king-move", "castled-later"):
        counts = Counter()
        for row in sorted(rows.values(), key=lambda item: item["id"]):
            if row["shape"] != shape or row["game"] in games:
                continue
            key = board_key(chess.Board(row["fen"]))
            if key in boards or counts[row["event"]] >= 4:
                continue
            result.append(row)
            counts[row["event"]] += 1
            games.add(row["game"])
            boards.add(key)
            if sum(counts.values()) == cap:
                break
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
    parser.add_argument("--per-shape", type=int, default=24)
    args = parser.parse_args()
    if args.per_shape < 1:
        parser.error("Expected at least one game per shape")
    dev, dev_sources = collect(args.development)
    reserve, reserve_sources = collect(args.reserve)
    late = {item["event"] for item in reserve.values()}
    games, boards = set(), set()
    train = selection({key: row for key, row in dev.items() if row["event"] not in late},
                      games, boards, args.per_shape)
    test = selection(reserve, games, boards, args.per_shape)
    write(args.output, dict(development=train, reserve=test))
    write(args.output.with_suffix(".manifest.json"), dict(
        selectionSha256=digest(args.output.read_bytes()), perShape=args.per_shape,
        sources=dict(development=dev_sources, reserve=reserve_sources),
        events=[sorted({row["event"] for row in split}) for split in (train, test)],
        counts=[dict(Counter(row["shape"] for row in split)) for split in (train, test)],
    ))
    print(len(train), len(test), Counter(row["shape"] for row in train), Counter(row["shape"] for row in test))


if __name__ == "__main__":
    main()
