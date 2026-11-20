"""Freeze observed pawn-displacement shapes independently of engine scores."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

import chess
import chess.pgn

from screen import observations, read, replay

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "competing-pawn-plans"))
from gather_plans import Broadcast, canonical, identify


def nominees(game, excluded):
    board = game.board()
    moves = list(game.mainline_moves())
    trace = [move.uci() for move in moves]
    original = board.fen()
    game_id = identify(board, trace)
    if game.errors or not board.is_valid() or board.chess960 or game_id in excluded:
        return
    if game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
        return
    url = game.headers.get("Site", "")
    groups = re.fullmatch(r"https://lichess\.org/broadcast/([^/]+)/(?:[^/]+/){2}[a-zA-Z0-9]{8}", url)
    if not groups:
        return
    group = re.sub(r"(?:-open-section|-open|-women|-section-[a-z]|-masters)$", "", groups[1])
    for ply, move in enumerate(moves[:100]):
        if 22 <= ply <= len(moves) - 7 and not board.is_check() and not board.is_capture(move):
            piece = board.piece_at(move.from_square)
            if (piece and piece.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK)
                    and not board.gives_check(move) and board.piece_type_at(moves[ply + 1].from_square) == chess.PAWN):
                game_line = trace[ply:ply + 12]
                events = observations(board, game_line, move.to_square, piece)
                if any(event["through"] == 6 for event in events):
                    key = sha256(f"pawn-displacement:{game_id}:{ply}".encode()).hexdigest()[:16]
                    played = replay(board, game_line)
                    detached = played[2][1].to_square
                    exchanged = any(
                        step[1].from_square == detached and step[0].is_capture(step[1]) and
                        index + 1 < len(played) and played[index + 1][1].to_square == step[1].to_square
                        and played[index + 1][0].is_capture(played[index + 1][1])
                        for index, step in enumerate(played[3:6], 3)
                    )
                    yield dict(id=key, game=game_id, group=group, event=group, site=url, fen=board.fen(),
                               playedMoveUci=move.uci(), history=dict(fen=original, moves=trace[:ply]),
                               sampled="exchange" if exchanged else "move-away", boardKey=canonical(board))
        board.push(move)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sources", type=Path, nargs="+", required=True)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    parser.add_argument("--without-group", action="append", default=[])
    args = parser.parse_args()
    games, boards, exclusions = set(), set(), {}
    for path in args.exclude:
        exclusions[path.name] = sha256(path.read_bytes()).hexdigest()
        for row in read(path):
            if "fen" in row:
                boards.add(canonical(chess.Board(row["fen"])))
            if (history := row.get("history")) and len(history["moves"]) >= 24:
                games.add(identify(chess.Board(history["fen"]), history["moves"]))
    candidates = []
    sources = {}
    for path in args.sources:
        received = []
        with path.open(encoding="utf-8-sig") as content:
            while (game := chess.pgn.read_game(content, Visitor=Broadcast)) is not None:
                received.extend(row for row in nominees(game, games) if row["group"] not in args.without_group)
        candidates.extend(received)
        sources[path.name] = dict(sha256=sha256(path.read_bytes()).hexdigest(),
                                  nominations=dict(Counter(r["sampled"] for r in received)))
    selected = []
    for shape, target in (("exchange", 24), ("move-away", 36)):
        uses = Counter()
        for row in sorted((r for r in candidates if r["sampled"] == shape), key=lambda r:r["id"]):
            if row["game"] in games or row["boardKey"] in boards or uses[row["group"]] >= 4:
                continue
            games.add(row["game"])
            boards.add(row.pop("boardKey"))
            uses[row["group"]] += 1
            selected.append(row)
            if sum(uses.values()) == target:
                break
    for path, value in (
        (args.output, selected),
        (args.output.with_suffix(".manifest.json"),
         dict(counts=dict(Counter(row["sampled"] for row in selected)),
              groups=sorted({row["group"] for row in selected}), sources=sources, exclusions=exclusions,
              excludedGroups=args.without_group)),
    ):
        with path.open("x", encoding="utf8", newline="\n") as out:
            json.dump(value, out, indent=2)
            out.write("\n")
    print(len(selected), dict(Counter(row["sampled"] for row in selected)))


if __name__ == "__main__":
    main()
