"""Collect the public classical sample and matched Stockfish lines."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib
import json
from pathlib import Path
import sys

import chess
import chess.engine
import chess.pgn

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/benchmarks"))
sampling = importlib.import_module("decision-evidence-tournament")
search = importlib.import_module("decision-evidence-probes")

ROOT_BUDGETS = (600_000, 2_400_000, 9_600_000)
REPLY_BUDGETS = (1_000_000, 4_000_000)


def write_new(path, result):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")


def exposed(board):
    for side in (chess.WHITE, chess.BLACK):
        for column, mask in enumerate(chess.BB_FILES):
            if mask & board.pieces_mask(chess.PAWN, side):
                continue
            if mask & board.pieces_mask(chess.ROOK, side):
                yield side, column


def recorded_rook_activity(before, after, initial):
    for side, column in set(exposed(after)) - initial:
        if not before.pieces_mask(chess.PAWN, side) & chess.BB_FILES[column]:
            continue
        for rook in after.pieces(chess.ROOK, side):
            rank = chess.square_rank(rook) if side else 7 - chess.square_rank(rook)
            if chess.square_file(rook) == column and 2 <= rank <= 6:
                return True
    return False


def challenge_games(path, candidates):
    choices = {}
    with path.open(encoding="utf-8-sig") as stream:
        while game := chess.pgn.read_game(stream):
            board = game.board()
            if game.errors or not board.is_valid():
                continue
            moves = list(game.mainline_moves())
            signature = sampling.board_key(board.fen()) + " " + " ".join(move.uci() for move in moves)
            key = sampling.digest(signature.encode())
            if key not in candidates:
                continue
            by_ply = {row["ply"]: row for row in candidates[key]}
            snapshots = [board.copy(stack=False)]
            for move in moves:
                board.push(move)
                snapshots.append(board.copy(stack=False))
            for index, before in enumerate(snapshots[:-8]):
                if before.ply() not in by_ply or before.is_check():
                    continue
                initial = set(exposed(before))
                if any(recorded_rook_activity(before, after, initial)
                       for after in snapshots[index + 2:index + 7]):
                    choices.setdefault(key, []).append(by_ply[before.ply()])
    return choices


def sample_positions(pgn_directory, previous, reserve):
    events = ["korea"] if reserve else ["rudar", "serbia-women", "world-junior", "buongoma"]
    seen_games, seen_boards = set(), set(previous)
    rows, counts = [], {}
    for name in events:
        path = pgn_directory / f"{name}.pgn"
        games = sampling.read_games(path, previous)
        control = sampling.select_event(name, games, 20 if reserve else 10, 0, seen_boards, seen_games)
        remaining = {key: positions for key, positions in games.items() if key not in seen_games}
        choices = challenge_games(path, remaining)
        challenge = sampling.select_event(name, choices, 10 if reserve else 5, 0, seen_boards, seen_games)
        for row in challenge:
            row["stratum"] = "recorded-rook-file"
        rows.extend(control + challenge)
        counts[name] = {
            "ordinary": len(control),
            "challenge": len(challenge),
            "pgnSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    if len({row["sourceGroup"] for row in rows}) != len(rows):
        raise ValueError("Two positions were sampled from the same game")
    if any(sampling.board_key(row["fen"]) in previous for row in rows):
        raise ValueError("A sampled position duplicates a previous board")
    return {"cases": rows, "events": counts}


def agrees(root, reply):
    if root["mate"] is not None:
        return reply["mate"] is not None and root["mate"] * reply["mate"] < 0
    return root["cp"] is not None and reply["cp"] is not None and abs(root["cp"] + reply["cp"]) <= 90


def examine(task):
    row, executable = task
    board = chess.Board(row["fen"])
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        for nodes in ROOT_BUDGETS:
            lines, root_cost = search.search_replies(engine, board, min(3, board.legal_moves.count()), nodes)
            if lines[0]["depth"] >= 18:
                break
        audit = []
        for index, line in enumerate(lines):
            best_cp, cp = lines[0]["cp"], line["cp"]
            if index > 0 and (cp is None or best_cp is None or best_cp - cp > 130):
                continue
            child = board.copy(stack=False)
            child.push_uci(line["pvUci"][0])
            width = min(3, child.legal_moves.count())
            if width == 0:
                continue
            for nodes in REPLY_BUDGETS:
                replies, cost = search.search_replies(engine, child, width, nodes)
                if replies[0]["depth"] >= 16 and agrees(line, replies[0]):
                    break
            audit.append({"moveUci": line["pvUci"][0], "lines": replies, "cost": cost})
    return dict(row, candidates=lines, replyProbes=audit[:1], referenceReplies=audit, rootCost=root_cost)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("previous", type=Path)
    parser.add_argument("--pgns", type=Path)
    parser.add_argument("--reserve", action="store_true")
    parser.add_argument("--sample-only", action="store_true")
    args = parser.parse_args()
    previous = {sampling.board_key(row["fen"]) for row in json.loads(args.previous.read_bytes())}
    name = "reserve" if args.reserve else "fresh"
    sample = sample_positions(args.pgns or args.directory, previous, args.reserve)
    write_new(args.directory / f"{name}-sample.json", sample)
    print("Frozen sample", sample["events"], flush=True)
    if args.sample_only:
        return
    results = []
    with ThreadPoolExecutor(4) as pool:
        tasks = [(row, args.engine) for row in sample["cases"]]
        for result in pool.map(examine, tasks):
            results.append(result)
            if len(results) % 10 == 0:
                print("Probed", len(results), "of", len(tasks), flush=True)
    write_new(args.directory / f"{name}-engine.json", results)


if __name__ == "__main__":
    main()
