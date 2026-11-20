"""Stage legal public classical benchmark PGNs for the isolated desktop app."""

import argparse
import json
from pathlib import Path
import re

import chess
import chess.pgn

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("qa", type=Path)
parser.add_argument("selection", type=Path)
args = parser.parse_args()
directory = args.qa.resolve() / "runtime-fixtures" / "documents"
if not directory.is_dir() or not (args.qa / "tauri.qa.json").is_file():
    parser.error("An isolated desktop QA directory is required")

rows = json.loads(args.selection.read_bytes())
if any(not re.fullmatch(r"[0-9a-f]{12,24}", row["id"]) for row in rows):
    raise ValueError("Unexpected case identity")
if len({row["id"] for row in rows}) != len(rows):
    raise ValueError("Duplicate case identity")
for row in rows:
    title = f"Classical Audit {row['id']}"
    game = chess.pgn.Game()
    board = chess.Board(row["history"]["fen"])
    game.setup(board)
    game.headers["Event"] = title
    game.headers["White"] = title
    game.headers["Black"] = "Stockfish QA Fixture"
    history = row["history"]["moves"]
    node = game
    for index, uci in enumerate([*history, row["playedMoveUci"]]):
        if index == len(history) and board.fen() != row["fen"]:
            raise ValueError(f"Frozen board and game history differ for {row['id']}")
        move = board.parse_uci(uci)
        node = node.add_variation(move)
        board.push(move)
    output = directory / (title + ".pgn")
    content = str(game) + "\n"
    if output.exists() and output.read_text(encoding="utf8") != content:
        raise ValueError(f"A fixture already occupies {output}")
    output.write_text(content, encoding="utf8", newline="\n")

print(len(rows), "legal classical audit fixtures", flush=True)
