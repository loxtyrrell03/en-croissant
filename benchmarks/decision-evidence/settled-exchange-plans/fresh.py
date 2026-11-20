"""Freeze independent exchange positions before seeing their scored choices."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn

from examine import HERE, SOURCES, exact, features, settlement, traced

sys.path.insert(0, str(HERE.parent / "neural-deep-witness"))
from frames import family, game_key
from sample import board_key, classical_sources
from search import engines, search


PROTOCOL = {"used": 80, "shape": 40, "control": 40}


def pick(game, fingerprint, blocked):
    board = game.board()
    moves = [m.uci() for m in game.mainline_moves()]
    if len(moves) < 45:
        return None
    candidates = []
    for i, uci in enumerate(moves[:-10]):
        move = board.parse_uci(uci)
        # Checks and capture sequences in the recorded game only nominate
        # cases. Candidate and reply analysis uses a new engine process.
        if i >= 30 and len(board.piece_map()) <= 24 and (
            board.is_capture(move) or board.gives_check(move)
            or any(board.piece_at(chess.Move.from_uci(item).to_square) for item in moves[i + 1:i + 4])
        ):
            if board_key(board) not in blocked:
                steps = traced(board, moves[i:i + 14])
                if steps and (trade := settlement(steps)):
                    effects = features(board, steps, trade)
                    stratum = "used" if any(v["uses"] for v in effects.values()) else "shape" if effects else "control"
                    token = sha256(f"settled-exchange-v1:{fingerprint}:{i}".encode()).hexdigest()
                    candidates.append((
                        {"used": 0, "shape": 1, "control": 2}[stratum], token, i, board.fen(), stratum,
                    ))
        board.push(move)
    if not candidates:
        return None
    _, token, ply, fen, stratum = min(candidates)
    return {
        "id": f"exchange-{token[:16]}", "game": fingerprint, "fen": fen, "stratum": stratum,
        "history": {"fen": game.board().fen(), "moves": moves[:ply]}, "recordedMove": moves[ply],
    }


def freeze(lab):
    games, boards = set(), set()
    exclusions = {}
    for name in (*SOURCES, "paired-passer-benchmark/sample.json", "checking-flight-defence/reserve.json"):
        raw = (lab / name).read_bytes()
        exclusions[name] = sha256(raw).hexdigest()
        data = json.loads(raw)
        rows = data if isinstance(data, list) else [r for g in data.values() for r in g]
        for row in rows:
            if row.get("history") and len(row["history"]["moves"]) >= 24:
                games.add(game_key(row))
            boards.add(board_key(chess.Board(row["fen"])))
    pools = defaultdict(list)
    development_events = ("buongoma", "asian-disabilities", "world-junior", "sants", "pall-mall", "witney")
    sources = classical_sources(lab)
    for file, (event, fallback) in sorted(sources.items(), key=lambda item: (item[1], item[0].name)):
        if any(name in event for name in development_events):
            continue
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                fingerprint = game_key({"history": {
                    "fen": game.board().fen(), "moves": [m.uci() for m in game.mainline_moves()],
                }})
                if fingerprint in games:
                    continue
                games.add(fingerprint)
                row = pick(game, fingerprint, boards)
                if not row:
                    continue
                boards.add(board_key(chess.Board(row["fen"])))
                site = game.headers.get("Site", "")
                pools[(row["stratum"], family(event))].append(dict(
                    row, event=family(event),
                    site=site if site.startswith("https://lichess.org/broadcast/") else fallback,
                ))
    for rows in pools.values():
        rows.sort(key=lambda row: row["id"])
    sampled = []
    for name, limit in PROTOCOL.items():
        keys = sorted(key for key in pools if key[0] == name)
        choices = [pools[key][i] for i in range(max((len(pools[key]) for key in keys), default=0))
                   for key in keys if i < len(pools[key])]
        sampled.extend(choices[:limit])
    return sampled, exclusions


def score(row, engine):
    board = chess.Board(row["history"]["fen"])
    for uci in row["history"]["moves"]:
        board.push_uci(uci)
    if board.fen() != row["fen"] or board.is_game_over(claim_draw=True):
        return dict(row, candidates=[], replyProbes=[])
    roots = search(board, engine, 2400000, min(3, board.legal_moves.count()))["lines"]
    probes = []
    for line in roots[:1]:
        if not exact(line, board):
            continue
        steps = traced(board, line["pvUci"])
        if not steps or not settlement(steps):
            continue
        move = line["pvUci"][0]
        child = board.copy()
        child.push_uci(move)
        if child.is_game_over(claim_draw=True):
            continue
        result = search(child, engine, 1400000, min(3, child.legal_moves.count()))["lines"]
        probes.append({"moveUci": move, "lines": result})
    return dict(row, candidates=roots, replyProbes=probes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest="mode", required=True)
    select = command.add_parser("freeze")
    for name in ("lab", "output", "manifest"):
        select.add_argument(name, type=Path)
    check = command.add_parser("score")
    for name in ("input", "engine", "output"):
        check.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.mode == "freeze":
        rows, exclusions = freeze(args.lab)
        with args.manifest.open("x", encoding="utf-8") as out:
            json.dump(exclusions, out, indent=2)
    else:
        source = json.loads(args.input.read_bytes())
        try:
            with ThreadPoolExecutor(7) as pool:
                rows = list(pool.map(lambda row: score(row, str(args.engine)), source))
        finally:
            for worker in engines:
                worker.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(rows, out, separators=(",", ":"))
        out.write("\n")
    print(dict(Counter(row["stratum"] for row in rows)), len({row["event"] for row in rows}), "families",
          sha256(args.output.read_bytes()).hexdigest(), flush=True)


if __name__ == "__main__":
    main()
