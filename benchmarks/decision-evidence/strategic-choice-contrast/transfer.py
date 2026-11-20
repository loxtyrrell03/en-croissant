"""Freeze new classical boards by game, event family and colour mirror."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.pgn

from probe import HERE, engines, initial, strategy
from sample import board_key, classical_sources
from search import search

spec = importlib.util.spec_from_file_location(
    "witness_frames", HERE.parent / "neural-deep-witness" / "frames.py"
)
frames = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frames)


def shortlist(game, excluded, fingerprint):
    board = game.board()
    moves = list(game.mainline_moves())
    options = []
    for ply, move in enumerate(moves):
        if 30 <= ply < len(moves) - 8 and not board.is_check() and board.ply() < 145:
            # The recorded move can nominate a board. Its engine rank remains unknown.
            actual = strategy(board, move)
            if actual or any(strategy(board, alternative) for alternative in board.legal_moves):
                key = board_key(board)
                if key not in excluded:
                    group = actual[0] if actual else "geometry-only"
                    token = sha256(f"strategic-choice-v2:{fingerprint}:{ply}".encode()).hexdigest()
                    options.append((not actual, token, ply, board.fen(), group))
        board.push(move)
    if not options:
        return
    _, token, ply, fen, group = min(options)
    return {
        "id": f"strategy-{token[:16]}", "game": fingerprint, "fen": fen, "stratum": group,
        "history": {"fen": game.board().fen(), "moves": [move.uci() for move in moves[:ply]]},
        "recordedMove": moves[ply].uci(), "cohort": "separate-classical",
    }


def freeze(lab, archive, development):
    boards, games, blocked_families = set(), set(), set()
    for row in archive:
        boards.add(board_key(chess.Board(row["fen"])))
        if row.get("history") and len(row["history"]["moves"]) >= 24:
            games.add(frames.game_key(row))
    for row in development:
        if row.get("event"):
            blocked_families.add(frames.family(row["event"]))
    pools = defaultdict(list)
    sources = {}
    for path, (event, fallback) in sorted(classical_sources(lab).items(), key=lambda x: (x[1], x[0].name)):
        family = frames.family(event)
        if family in blocked_families:
            continue
        sources[path.relative_to(lab).as_posix()] = sha256(path.read_bytes()).hexdigest()
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*" or game.end().ply() < 45:
                    continue
                fingerprint = frames.game_key({"history": {
                    "fen": game.board().fen(), "moves": [move.uci() for move in game.mainline_moves()],
                }})
                if fingerprint in games:
                    continue
                games.add(fingerprint)
                row = shortlist(game, boards, fingerprint)
                if not row:
                    continue
                boards.add(board_key(chess.Board(row["fen"])))
                site = game.headers.get("Site", "")
                pools[row["stratum"], family].append(dict(
                    row, event=family, site=site if site.startswith("https://lichess.org/broadcast/") else fallback,
                ))
    result = []
    for stratum in ("passer", "rook-file", "outpost", "geometry-only"):
        family_pools = [sorted(rows, key=lambda row: row["id"])
                        for key, rows in sorted(pools.items()) if key[0] == stratum]
        ordered = [rows[i] for i in range(max(map(len, family_pools), default=0))
                   for rows in family_pools if i < len(rows)]
        result.extend(ordered[:24])
    return result, sources, sorted(blocked_families)


def scored(row, exe):
    board = initial(row)
    if board.is_game_over(claim_draw=True):
        return dict(row, candidates=[], replyProbes=[])
    roots = search(board, exe, 2_400_000, min(3, board.legal_moves.count()))["lines"]
    replies = []
    if roots:
        move = roots[0]["pvUci"][0]
        board.push_uci(move)
        if not board.is_game_over(claim_draw=True):
            lines = search(board, exe, 1_400_000, min(3, board.legal_moves.count()))["lines"]
            replies.append({"moveUci": move, "lines": lines})
    return dict(row, candidates=roots, replyProbes=replies)


def write(path, data):
    with path.open("x", encoding="utf-8") as file:
        json.dump(data, file, separators=(",", ":"), ensure_ascii=False)
        file.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    select = sub.add_parser("freeze")
    for name in ("lab", "archive", "development", "output", "manifest"):
        select.add_argument(name, type=Path)
    analyze = sub.add_parser("score")
    for name in ("input", "engine", "output"):
        analyze.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == "freeze":
        archive, dev = args.archive.read_bytes(), args.development.read_bytes()
        result, sources, excluded_families = freeze(args.lab, json.loads(archive), json.loads(dev))
        write(args.manifest, {
            "archiveSha256": sha256(archive).hexdigest(), "developmentSha256": sha256(dev).hexdigest(),
            "sources": sources, "excludedEventFamilies": excluded_families,
        })
    else:
        rows = json.loads(args.input.read_bytes())
        try:
            with ThreadPoolExecutor(7) as pool:
                result = list(pool.map(lambda row: scored(row, str(args.engine)), rows))
        finally:
            for worker in engines:
                worker.quit()
    print(Counter(row["stratum"] for row in result), len({row["event"] for row in result}), flush=True)
    write(args.output, result)


if __name__ == "__main__":
    main()
