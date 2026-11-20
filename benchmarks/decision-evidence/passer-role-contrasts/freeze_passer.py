"""Freeze an advanced-pawn challenge and an ordinary classical comparison."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path
import re

import chess.pgn

from pawn_plans import assets
from freeze import Games, board_key, family, hash_fields, read, write

SEED = "original-passer-strategic-role-2026-11"


def curate(sources, raw, prior, development):
    families = {family(row.get("event", "") or row.get("group", "")) for row in development}
    board_keys = {board_key(chess.Board(row["fen"])) for row in [*prior, *development]}
    prefixes = set()
    for row in [*prior, *development]:
        history = row.get("history") or {}
        if len(history.get("moves", [])) >= 24:
            prefixes.add(hash_fields(history["fen"], *history["moves"][:24]))
    seen, available, pool = set(), Counter(), defaultdict(list)
    included = []
    for source in sources:
        group = family(source["slug"])
        if group in families:
            continue
        pg = raw / source["file"]
        if sha256(pg.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Source differs: {pg}")
        included.append(source)
        with pg.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Games)) is not None:
                if game.errors or game.headers.get("Result") not in {"1-0","0-1","1/2-1/2"}:
                    continue
                board = game.board()
                if not board.is_valid() or board.chess960:
                    continue
                moves = list(game.mainline_moves())
                uci = [move.uci() for move in moves]
                start = board.fen()
                identity = hash_fields(start, *uci[:24])
                if len(moves) < 42 or identity in prefixes or identity in seen:
                    continue
                seen.add(identity)
                available[group] += 1
                choices = {}
                for ply, move in enumerate(moves):
                    if 26 <= ply <= min(len(moves)-8, 112) and not board.is_check() and board.halfmove_clock < 35:
                        ticket = hash_fields(SEED, identity, ply)[:20]
                        choices_for_ply = ("ordinary", "advanced") if assets(board) else ("ordinary",)
                        for cohort in choices_for_ply:
                            if (cohort in choices and choices[cohort]["id"] <= ticket) or board_key(board) in board_keys:
                                continue
                            site = game.headers.get("Site", "")
                            choices[cohort] = dict(id=ticket, game=identity, group=group, event=source["slug"],
                                site=site if site.startswith("https://lichess.org/broadcast/") else source["url"],
                                category=cohort, fen=board.fen(), history=dict(fen=start,moves=uci[:ply]),
                                recorded=uci[ply:ply+8])
                    board.push(move)
                for category, entry in choices.items():
                    pool[group, category].append(entry)
    picked, rows = set(), []
    for cohort, limit in (("advanced", 72), ("ordinary", 48)):
        limit_by_source = Counter()
        ordered = [sorted(entries, key=lambda item: item["id"]) for (_, kind), entries in sorted(pool.items())
                   if kind == cohort]
        for index in range(max(map(len, ordered), default=0)):
            if sum(limit_by_source.values()) == limit:
                break
            for entries in ordered:
                if index >= len(entries) or sum(limit_by_source.values()) == limit:
                    continue
                row = entries[index]
                key = board_key(chess.Board(row["fen"]))
                if (row["game"] in picked or key in board_keys or limit_by_source[row["group"]] >= 8):
                    continue
                picked.add(row["game"])
                board_keys.add(key)
                limit_by_source[row["group"]] += 1
                rows.append(row)
    return rows, included, dict(available)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("sources", "raw", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--prior", type=Path, nargs="+", required=True)
    parser.add_argument("--development", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    prior = [row for p in args.prior for row in read(p)]
    development = [row for p in args.development for row in read(p)]
    rows, sources, totals = curate(read(args.sources), args.raw, prior, development)
    write(args.output, rows)
    write(args.output.with_suffix(".manifest.json"), dict(seed=SEED, sources=sources, eligible=totals,
        sha256=sha256(args.output.read_bytes()).hexdigest(),
        counts=dict(Counter(row["category"] for row in rows)), groups=dict(Counter(row["group"] for row in rows)),
        exclusions=[dict(name=p.name, sha256=sha256(p.read_bytes()).hexdigest())
                    for p in [*args.prior, *args.development]]))
    print(len(rows), Counter(row["category"] for row in rows), len({row["group"] for row in rows}), flush=True)
