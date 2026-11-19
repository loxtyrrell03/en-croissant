"""Sample classical decisions where a weak reply might allow a live fork."""

import argparse
import concurrent.futures
import hashlib
import importlib
import json
from pathlib import Path

import chess
import chess.engine

sample = importlib.import_module("decision-evidence-fork-classical-sample")
payoff = sample.payoff
PREVIEW_NODES = 12_000


def threats(board, move):
    if board.gives_check(move):
        return ()
    squares = payoff.geometry(board, move)
    if not squares:
        return ()
    side = board.turn
    post = board.copy(stack=False)
    post.push(move)
    post.turn = side
    post.ep_square = None
    role = post.piece_type_at(move.to_square)
    if role == chess.KING:
        return ()
    viable = []
    for target in squares:
        victim = post.piece_type_at(target)
        capture = chess.Move(move.to_square, target)
        if victim == chess.KING or capture not in post.legal_moves:
            continue
        leaf = post.copy(stack=False)
        leaf.push(capture)
        value = payoff.VALUES[victim] - payoff.VALUES[role] if leaf.attackers(not side, target) else payoff.VALUES[victim]
        if value >= 90:
            viable.append(target)
    return tuple(viable)


def screen(batch):
    rows, executable = batch
    triggered = []
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        for row in rows:
            board = chess.Board(row["fen"])
            move = board.parse_uci(row["move"])
            targets = threats(board, move)
            if len(targets) < 2:
                continue
            board.push(move)
            replies = payoff.search(engine, board, PREVIEW_NODES)
            if len(replies) < 2:
                continue
            best, other = replies
            if best["cp"] is None or other["cp"] is None or best["cp"] - other["cp"] < 70:
                continue
            defence = board.parse_uci(best["pv"][0])
            if defence.to_square != move.to_square or len(other["pv"]) < 2:
                continue
            candidate = chess.Move.from_uci(other["pv"][1])
            if candidate.from_square == move.to_square and candidate.to_square in targets:
                triggered.append(dict(row, stratum="alternative-fork", preview=best["depth"]))
    return triggered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--event", nargs=2, action="append", metavar=("NAME", "PGN"), required=True)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6)
    parser.add_argument("--per-event", type=int, default=9)
    args = parser.parse_args()
    exclusions = {}
    games, boards = set(), set()
    for path in args.exclude:
        exclusions.setdefault(path.name, []).append(hashlib.sha256(path.read_bytes()).hexdigest())
        for row in payoff.read(path)["cases"]:
            boards.add(sample.corpus.board_identity(chess.Board(row["fen"])))
            game = row.get("game") or row.get("sourceGroup")
            if game:
                games.add(game)
    sources = {}
    rows = []
    for event, file in args.event:
        path = Path(file)
        eligible = sample.select_games(path, event, boards, games)
        candidates = [row for options in eligible.values() for row in options]
        sources[event] = dict(pgnSha256=hashlib.sha256(path.read_bytes()).hexdigest(), candidates=len(candidates))
        rows.extend(candidates)
    batches = [(rows[i:i + 70], str(args.engine.resolve())) for i in range(0, len(rows), 70)]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        triggered = [row for found in pool.map(screen, batches) for row in found]
    candidates = []
    for event in sources:
        entries = [row for row in triggered if row["event"] == event]
        sources[event]["triggered"] = len(entries)
        count = 0
        for row in sorted(entries, key=lambda item: payoff.key(item["id"])):
            if count == args.per_event:
                break
            if row["game"] in games or row["boardKey"] in boards:
                continue
            games.add(row["game"])
            boards.add(row["boardKey"])
            candidates.append(row)
            count += 1
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(dict(previewBudget=PREVIEW_NODES, sources=sources, exclusions=exclusions, cases=candidates), file, indent=2)
    print(json.dumps(dict(screened=len(rows), triggered=len(triggered), selected=len(candidates), byEvent=sources)))


if __name__ == "__main__":
    main()
