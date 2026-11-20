"""Keep one held-out public solution per game and separate source themes."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import argparse
import json

import chess


def select(source, output):
    cases = json.loads(source.read_bytes())["cases"]
    order = lambda row: sha256(("discovery-identity-v1:" + row["id"]).encode()).digest()
    counts = Counter()
    games, boards = set(), set()
    selected = []
    near = {"clearance", "deflection", "capturingDefender", "intermezzo"}
    for row in sorted((r for r in cases if r["split"] == "test"), key=order):
        fen = row["fen"]
        board = chess.Board(fen)
        key = min(board.epd(), board.mirror().epd())
        tags = set(row["tags"])
        group = "discovery" if "discoveredAttack" in tags else "related" if tags & near else "other"
        if row["game"] in games or key in boards or counts[group] >= 150:
            continue
        games.add(row["game"])
        boards.add(key)
        counts[group] += 1
        selected.append({
            "id": row["id"], "game": row["game"], "fen": fen, "tags": row["tags"], "cohort": group,
            "candidates": [{"fen": fen, "pvUci": row["line"], "cp": 0, "depth": 18}],
        })
    with output.open("x", encoding="utf-8") as stream:
        json.dump(selected, stream, separators=(",", ":"))
    print(dict(counts))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    select(args.source, args.output)
