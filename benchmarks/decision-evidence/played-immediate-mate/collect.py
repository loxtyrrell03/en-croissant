"""Sample recorded classical moves and replay matched Stockfish comparisons."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.engine
import chess.pgn


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


develop = load("prepare", Path("benchmarks/decision-evidence/opened-rook-file/prepare.py"))
verifier = load("reference", Path("benchmarks/decision-evidence/immediate-mate-defence/scan.py"))


def can_avoid_mate(before):
    for alternative in list(before.legal_moves):
        before.push(alternative)
        ends_game = before.is_game_over()
        no_mating_reply = not verifier.mates(before)
        before.pop()
        if ends_game or no_mating_reply:
            return True
    return False


def sample_event(path, seen, quota):
    sampler = develop.sampling
    classes = {key: {} for key in ("recorded-mate", "unavoidable", "ordinary")}
    games, visited = 0, 0
    with path.open(encoding="utf-8-sig") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            if game.errors or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                continue
            board = game.board()
            if board.fen() != chess.STARTING_FEN:
                continue
            moves = list(game.mainline_moves())
            key = sampler.digest((sampler.board_key(board.fen()) +
                                  " " + " ".join(move.uci() for move in moves)).encode())
            if key in seen:
                continue
            games += 1
            for ply, move in enumerate(moves):
                if ply < 20 or board.is_game_over():
                    board.push(move)
                    continue
                fen = board.fen()
                legal_count = board.legal_moves.count()
                board.push(move)
                visited += 1
                checkmates = [] if board.is_game_over() else verifier.mates(board)
                if checkmates:
                    board.pop()
                    kind = "recorded-mate" if can_avoid_mate(board) else "unavoidable"
                    board.push(move)
                elif legal_count > 1 and ply + 7 < len(moves):
                    kind = "ordinary"
                else:
                    continue
                classes[kind].setdefault(key, []).append({
                    "fen": fen, "history": {"fen": chess.STARTING_FEN,
                                            "moves": [item.uci() for item in moves[:ply]]},
                    "ply": ply, "playedMoveUci": move.uci(), "stratum": kind,
                    "mateReplies": checkmates, "sourceGroup": key, "event": path.stem,
                    "id": f"played-mate-{path.stem}-{key[:16]}-{ply}",
                })
    picked = []
    for stratum, count in zip(classes, quota, strict=True):
        picked.extend(verifier.choose(classes[stratum], count, "played-mate-1", seen, sampler))
    return picked, {"games": games, "positions": visited,
                    "populations": {key: len(value) for key, value in classes.items()},
                    "selected": {key: sum(row["stratum"] == key for row in picked) for key in classes},
                    "pgnSha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def paired(engine, board, roots, nodes):
    engine.configure({"Clear Hash": None})
    parser = develop.search.root_search.CompleteVariations(board, 2, roots)
    budget = chess.engine.Limit(nodes=nodes)
    cost = 0
    with engine.analysis(board, budget, multipv=2, root_moves=roots) as stream:
        for info in stream:
            parser.add(info)
            cost = max(cost, info.get("nodes", 0))
    return [
        {"fen": board.fen(), "depth": info["depth"],
         "cp": info["score"].pov(board.turn).score(), "mate": info["score"].pov(board.turn).mate(),
         "pvUci": [move.uci() for move in info["pv"]]}
        for info in parser.best
    ], cost


def search_reply(engine, board, line):
    child = board.copy()
    child.push_uci(line["pvUci"][0])
    if child.is_game_over():
        return None, 0
    cost = 0
    for budget in develop.REPLY_BUDGETS:
        replies, receipt = develop.search.search_replies(engine, child, min(3, child.legal_moves.count()), budget)
        cost += receipt["nodes"]
        if replies[0]["depth"] >= 16 and develop.agrees(line, replies[0]):
            break
    return {"moveUci": line["pvUci"][0], "lines": replies}, cost


def analyse(task):
    row, executable = task
    board = chess.Board(row["history"]["fen"])
    for item in row["history"]["moves"]:
        board.push_uci(item)
    assert board.fen() == row["fen"]
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        for budget in develop.ROOT_BUDGETS:
            lines, _ = develop.search.search_replies(engine, board, min(3, board.legal_moves.count()), budget)
            if lines[0]["depth"] >= 18 or lines[0]["mate"] is not None:
                break
        leader = lines[0]
        recorded = row["playedMoveUci"]
        comparison, paired_nodes = ([], 0)
        if leader["pvUci"][0] != recorded:
            comparison, paired_nodes = paired(engine, board,
                [board.parse_uci(leader["pvUci"][0]), board.parse_uci(recorded)], budget)
        played_line = next((line for line in comparison if line["pvUci"][0] == recorded), None)
        played, played_nodes = search_reply(engine, board, played_line) if played_line else (None, 0)
        best, _ = search_reply(engine, board, leader)
        probes = [probe for probe in (played, best) if probe]
    return dict(row, candidates=lines, comparisonCandidates=comparison or None,
                replyProbes=probes, pairedNodes=paired_nodes, playedReplyNodes=played_nodes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("events", nargs="+", type=Path)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--quota", type=int, nargs=3, default=(8, 3, 6))
    parser.add_argument("--previous", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    earlier = [row for path in args.previous for row in json.loads(path.read_bytes())]
    seen = {develop.sampling.board_key(row["fen"]) for row in earlier}
    seen.update(row.get("sourceGroup") for row in earlier)
    cases, source = [], {}
    for path in args.events:
        picks, metadata = sample_event(path, seen, args.quota)
        cases.extend(picks)
        source[path.stem] = metadata
        print(path.stem, metadata, flush=True)
    develop.write_new(args.directory / "sample.json", {"cases": cases, "events": source})
    analysed = []
    with ThreadPoolExecutor(5) as executor:
        for row in executor.map(analyse, ((row, args.engine) for row in cases)):
            analysed.append(row)
            if len(analysed) % 8 == 0:
                print("Analysed", len(analysed), flush=True)
    develop.write_new(args.directory / "engine.json", analysed)


if __name__ == "__main__":
    main()
