"""Freeze classical game samples before any engine search."""

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import re

import chess.pgn

from capture_order import nomination

SEED = "defender-capture-order-november-2026"


def read(path):
    return json.loads(path.read_bytes())


def write(path, payload):
    with path.open("x", encoding="utf8", newline="\n") as destination:
        json.dump(payload, destination, separators=(",", ":"), ensure_ascii=False)
        destination.write("\n")


def hash_fields(*fields):
    return sha256("|".join(map(str, fields)).encode()).hexdigest()


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def family(name):
    match = re.search(r"[a-z].*?[- ](20\d\d)(?:[- ]|$)", name.lower())
    return name.lower()[:match.end(1)] if match else name.lower()


class Games(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def freeze(sources, prior, directory):
    games, boards, excluded_families = set(), set(), set()
    for row in prior:
        boards.add(board_key(chess.Board(row["fen"])))
        history = row.get("history") or {}
        if len(history.get("moves", [])) >= 24:
            games.add(hash_fields(history["fen"], *history["moves"][:24]))
        if location := row.get("site") or row.get("sourceUrl"):
            if match := re.match(r"https://lichess\.org/broadcast/([^/]+)/", location):
                excluded_families.add(family(match[1]))
        for name in ("event", "group"):
            if event := row.get(name):
                excluded_families.add(family(event))
    pools = defaultdict(list)
    included = []
    eligible = Counter()
    for source in sources:
        group = family(source["slug"])
        if group in excluded_families:
            continue
        path = directory / source["file"]
        if sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Source hash differs: {path}")
        included.append(source)
        with path.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Games)) is not None:
                if game.errors or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                moves = list(game.mainline_moves())
                history_fen = board.fen()
                trace = [move.uci() for move in moves]
                identifier = hash_fields(history_fen, *trace[:24])
                if len(moves) < 38 or identifier in games:
                    continue
                games.add(identifier)
                eligible[group] += 1
                choices = {}
                for ply, move in enumerate(moves):
                    if 26 <= ply <= min(112, len(moves) - 7) and not board.is_check() and board.halfmove_clock < 35:
                        candidate = nomination(board, trace[ply:ply+7])
                        category = "capture-order" if candidate else "ordinary"
                        priority = hash_fields(SEED, identifier, ply)[:20]
                        if (category not in choices or priority < choices[category]["id"]) and board_key(board) not in boards:
                            site = game.headers.get("Site", "")
                            choices[category] = dict(id=priority, game=identifier, fen=board.fen(), group=group,
                                event=source["slug"], site=site if site.startswith("https://lichess.org/broadcast/") else source["url"],
                                category=category, history=dict(fen=history_fen, moves=trace[:ply]),
                                recorded=trace[ply:ply+7], candidate=asdict(candidate) if candidate else None)
                    board.push(move)
                for category, choice in choices.items():
                    pools[group, category].append(choice)

    sample = []
    chosen_games = set()
    for category, limit, per_group in (("capture-order", 96, 10), ("ordinary", 48, 4)):
        count = 0
        chosen_groups = Counter()
        queues = [sorted(rows, key=lambda x: x["id"]) for (_, kind), rows in sorted(pools.items()) if kind == category]
        for index in range(max(map(len, queues), default=0)):
            if count == limit:
                break
            for rows in queues:
                if index >= len(rows) or count == limit:
                    continue
                row = rows[index]
                key = board_key(chess.Board(row["fen"]))
                if row["game"] in chosen_games or key in boards or chosen_groups[row["group"]] == per_group:
                    continue
                chosen_games.add(row["game"])
                boards.add(key)
                chosen_groups[row["group"]] += 1
                sample.append(row)
                count += 1
    return sample, included, eligible, sum(len(rows) for (_, kind), rows in pools.items() if kind == "capture-order")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("prior", type=Path, nargs="+")
    args = parser.parse_args()
    sample, included, eligible, targeted_games = freeze(read(args.sources),
        [row for path in args.prior for row in read(path)], args.sources.parent)
    write(args.output, sample)
    write(args.output.with_suffix(".manifest.json"), dict(seed=SEED, sources=included,
        eligible=dict(eligible), targetedGames=targeted_games, sha256=sha256(args.output.read_bytes()).hexdigest(),
        counts=dict(Counter(x["category"] for x in sample)), groups=dict(Counter(x["group"] for x in sample)),
        excluded=[dict(file=p.name, sha256=sha256(p.read_bytes()).hexdigest()) for p in args.prior]))
    print("games", sum(eligible.values()), "targeted", targeted_games, "sample", len(sample))
