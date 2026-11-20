"""Audit older short event IDs and missing game histories against public PGNs."""

import argparse
from collections import defaultdict
import json
from pathlib import Path

import chess
import chess.pgn

from transfer import board_key, classical_sources, frames


def normalized_family(name):
    if name.startswith("allsvenskan-"):
        return "allsvenskan-2026"
    return frames.family(name)


def audit(lab, archive, selected, development):
    targeted = {board_key(chess.Board(row["fen"])) for row in development}
    all_archive_boards = {board_key(chess.Board(row["fen"])) for row in archive}
    by_board, sampled_game_hits = defaultdict(set), defaultdict(set)
    game_ids = {row["game"] for row in selected}
    for file, (event, _) in sorted(classical_sources(lab).items()):
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors:
                    continue
                moves = list(game.mainline_moves())
                fingerprint = frames.game_key({"history": {
                    "fen": game.board().fen(), "moves": [m.uci() for m in moves],
                }})
                sampled_game = fingerprint in game_ids
                board = game.board()
                for move in moves:
                    if board.ply() >= 18:
                        key = board_key(board)
                        if key in targeted:
                            by_board[key].add(frames.family(event))
                        if sampled_game and key in all_archive_boards:
                            sampled_game_hits[fingerprint].add(board.fen())
                    board.push(move)
    used = set()
    mapping = {}
    for row in development:
        matches = by_board[board_key(chess.Board(row["fen"]))]
        used.update(normalized_family(name) for name in matches)
        if "european-youth" in row["id"]:
            used.add("european-youth-2026")
        mapping[row["id"]] = sorted(matches)
    return {
        "sameGameAudit": {r["id"]: sorted(sampled_game_hits[r["game"]])
                          for r in selected if r["game"] in sampled_game_hits},
        "sharedFamilyCases": {r["id"]: r["event"] for r in selected
                              if normalized_family(r["event"]) in used},
        "developmentSourceMatches": mapping,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("lab", "archive", "selected", "development", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    paths = args.archive, args.selected, args.development
    result = audit(args.lab, *(json.loads(p.read_bytes()) for p in paths))
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(result, file, indent=2)
        file.write("\n")
    print({key: len(value) for key, value in result.items()})


if __name__ == "__main__":
    main()
