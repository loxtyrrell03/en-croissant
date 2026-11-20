"""Select game-grouped challenges using the played move and recorded reply only."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re

import chess.pgn

from ray_review import SLIDERS, TARGETS, aligned_after_reply, payments

SEED = "en-croissant-shared-ray-mistake-2026-11"


class Game(chess.pgn.GameBuilder):
    def begin_variation(self):
        return chess.pgn.SKIP

    def visit_comment(self, comment):
        pass


def ticket(*parts):
    return sha256("\0".join(str(part) for part in parts).encode()).hexdigest()


def family(name):
    return re.sub(r"(?:-)+(?:group|section|open|women|masters|challengers|u\d{2})(?:-.*)?$", "", name)


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def load_index(path):
    return json.loads(path.read_bytes())


def classical(control):
    match = re.match(r"\s*(\d+)\s*(?:min|[+'’])", control, re.IGNORECASE)
    return bool((match and int(match[1]) >= 60) or re.match(r"\s*1\s*h\b", control, re.IGNORECASE))


def collect(sources, raw, exclusions):
    blocked_groups = {family(row.get("event","")) for row in exclusions}
    excluded_boards = {board_key(chess.Board(row["fen"])) for row in exclusions}
    ignored_prefix = {
        ticket(history["fen"], *(history["moves"] + row.get("recorded", []))[:28])
        for row in exclusions if (history := row.get("history")) and
        len(history["moves"]) + len(row.get("recorded", [])) >= 28
    }
    pool = defaultdict(dict)
    seen = set()
    for source in sources:
        slug = source["slug"]
        group = family(slug)
        if (group in blocked_groups or re.search(r"blitz|rapid|tiebreak|freestyle|online", slug)
            or not classical(source["timeControl"])):
            continue
        path = raw / source["directory"] / source["file"]
        if sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Changed source {path}")
        count = Counter()
        with path.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Game)) is not None:
                if game.errors or game.headers.get("Result") not in {"1-0","0-1","1/2-1/2"}:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                moves = list(game.mainline_moves())
                uci = [move.uci() for move in moves]
                start = board.fen()
                identity = ticket(start, *uci[:28])
                if len(moves) < 40 or identity in seen or identity in ignored_prefix:
                    continue
                seen.add(identity)
                chosen = {}
                for ply, played in enumerate(moves):
                    in_window = 22 <= ply <= min(len(moves)-7, 104) and not board.is_check() and board.halfmove_clock < 30
                    candidate = in_window and board.piece_type_at(played.from_square) in TARGETS and not board.is_capture(played)
                    fen = board.fen() if in_window else ""
                    board.push(played)
                    if not in_window:
                        continue
                    reply = moves[ply+1]
                    targets = (aligned_after_reply(board, played.to_square, reply)
                               if candidate and board.piece_type_at(reply.from_square) in SLIDERS else [])
                    recorded = uci[ply:ply+9]
                    paid = targets and any(
                        any(payments(chess.Board(fen), recorded, reply.to_square, pair)) for pair in targets
                    )
                    cohorts = ["ordinary"] if not targets else ["ray", "recordedCapture"] if paid else ["ray"]
                    rank = ticket(SEED, identity, ply)[:20]
                    for cohort in cohorts:
                        if cohort in chosen and rank >= chosen[cohort]["id"]:
                            continue
                        if board_key(chess.Board(fen)) in excluded_boards:
                            continue
                        site = game.headers.get("Site", "")
                        chosen[cohort] = dict(
                            id=rank, game=identity, group=group, event=slug, category=cohort, fen=fen,
                            history=dict(fen=start, moves=uci[:ply]), recorded=recorded,
                            site=site if site.startswith("https://lichess.org/broadcast/") else source["url"],
                        )
                for cohort, decision in chosen.items():
                    pool[group, cohort][identity] = decision
                    count[cohort] += 1
        if count:
            print(slug, dict(count), flush=True)
    return pool


def select(pool, groups, quotas, prior=()):
    games = {row["game"] for row in prior}
    keys = {board_key(chess.Board(row["fen"])) for row in prior}
    result = []
    for cohort, limit in quotas:
        entries = {group: sorted(pool[group, cohort].values(), key=lambda row: row["id"]) for group in groups}
        count = 0
        for index in range(max(map(len, entries.values()), default=0)):
            for group in groups:
                if count == limit:
                    break
                if len(entries[group]) <= index:
                    continue
                row = entries[group][index]
                key = board_key(chess.Board(row["fen"]))
                if row["game"] in games or key in keys:
                    continue
                result.append(row)
                games.add(row["game"])
                keys.add(key)
                count += 1
            if count == limit:
                break
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("raw", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    sources = load_index(args.sources)
    exclusions = [row for path in args.exclude for row in load_index(path)]
    pool = collect(sources, args.raw, exclusions)
    groups = sorted({group for group, cohort in pool if cohort == "ray"}, key=lambda group: ticket(SEED, group))
    development_groups = groups[::3]
    reserve_groups = [group for index, group in enumerate(groups) if index % 3]
    development = select(pool, development_groups, [("ray", 48), ("ordinary", 20)])
    reserve = select(pool, reserve_groups, [("ray", 96), ("ordinary", 40)], development)
    enriched_development = select(pool, development_groups, [("recordedCapture", 60)], [*development, *reserve])
    enriched_reserve = select(pool, reserve_groups, [("recordedCapture", 60)], [*development, *reserve, *enriched_development])
    result = dict(seed=SEED, development=development, reserve=reserve,
                  enrichedDevelopment=enriched_development, enrichedReserve=enriched_reserve,
                  sources=sources, sourceDigest=sha256(args.sources.read_bytes()).hexdigest(),
                  exclusions=[dict(name=path.name, sha256=sha256(path.read_bytes()).hexdigest())
                              for path in args.exclude])
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, separators=(",", ":"))
        stream.write("\n")
    print("development", len(development), "reserve", len(reserve), "groups", len(groups), flush=True)


if __name__ == "__main__":
    main()
