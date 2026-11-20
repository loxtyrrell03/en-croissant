"""Freeze public decisions for a transfer check of the shared pawn lever."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

import chess

from plans import contacts, initial, replay

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "competing-pawn-plans"))
from gather_plans import canonical, digest, identify, select


def source_event(row):
    parts = re.fullmatch(r"https://lichess\.org/broadcast/([^/]+)/[^/]+/[^/]+/([A-Za-z0-9]{8})", row["source"] or "")
    if not parts:
        return None
    group, chapter = parts.groups()
    name = re.sub(r"(?:-open-section|-open|-women|-section-[a-z]|-masters)$", "", group)
    return name, chapter


def choose(candidates, used_games, used_boards, kind, maximum):
    groups = Counter()
    chosen = []
    for row in sorted(candidates, key=lambda item: item["id"]):
        if (row["shape"] != kind or row["game"] in used_games or (key := row["boardKey"]) in used_boards
                or groups[row["event"]] >= 4):
            continue
        groups[row["event"]] += 1
        used_games.add(row["game"])
        used_boards.add(key)
        chosen.append({name: value for name, value in row.items() if name != "boardKey"})
        if len(chosen) == maximum:
            break
    return chosen


def prior_rows(path):
    data = json.loads(path.read_bytes())
    return data if isinstance(data, list) else [
        row for scope in data.values() if isinstance(scope, list) for row in scope
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sources", type=Path, nargs="+", required=True)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    prior = [row for path in args.exclude for row in prior_rows(path) if row.get("fen")]
    boards = {canonical(chess.Board(row["fen"])) for row in prior}
    games = {identify(chess.Board(history["fen"]), history["moves"])
             for row in prior if (history := row.get("history")) and len(history["moves"]) >= 24}
    candidates, provenance = [], {}
    for source, rows in select(args.sources, games, boards):
        shape_count = Counter()
        for row in rows:
            group = source_event(row)
            if not group:
                continue
            event, chapter = group
            board = initial(row)
            played = contacts(board, replay(board, row["gameLine"]), True)
            shape = "advance" if any(p.ply == 0 and p.kind == "advance" for p in played) else "other"
            item = dict(row, event=event, chapter=chapter, shape=shape, playedMoveUci=row["played"])
            candidates.append(item)
            shape_count[shape] += 1
        provenance[source.name] = dict(sha256=digest(source.read_bytes()), nominees=dict(shape_count))
    frozen = [
        *choose(candidates, games, boards, "advance", 36),
        *choose(candidates, games, boards, "other", 22),
    ]
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(frozen, out, indent=2)
        out.write("\n")
    manifest = dict(
        counts=dict(Counter(row["shape"] for row in frozen)),
        events=sorted({row["event"] for row in frozen}), sha256=digest(args.output.read_bytes()),
        sources=provenance, exclusions={path.name: digest(path.read_bytes()) for path in args.exclude},
    )
    with args.output.with_suffix(".manifest.json").open("x", encoding="utf8", newline="\n") as out:
        json.dump(manifest, out, indent=2)
        out.write("\n")
    print(len(frozen), manifest["counts"], len(manifest["events"]))


if __name__ == "__main__":
    main()
