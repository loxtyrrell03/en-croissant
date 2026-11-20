"""Build exact candidate and reply searches for a fork defence benchmark."""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib
import json
from pathlib import Path
import sys
from time import perf_counter

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/benchmarks"))
payoff = importlib.import_module("decision-evidence-fork-payoff")
corpus = payoff.corpus
PREVIEW_NODES = 12_000
ROOT_NODES = 1_200_000
REPLY_NODES = 2_400_000


def fork_squares(board, move):
    targets = payoff.geometry(board, move)
    if not targets:
        return ()
    after = board.copy(stack=False)
    after.push(move)
    try:
        attacker = after.piece_type_at(move.to_square)
        if attacker == chess.KING or after.is_game_over():
            return ()
    except ValueError:
        return ()
    if not any(action.to_square == move.to_square and action.from_square in targets
               for action in after.legal_moves):
        return ()
    return targets


def propose(pool, excluded):
    games = {row["game"] for row in excluded if "game" in row}
    boards = {corpus.board_identity(chess.Board(row["fen"])) for row in excluded}
    for row in pool["cases"]:
        if row["game"] in games:
            continue
        board = chess.Board(row["fen"])
        usable = False
        for ply, uci in enumerate(row["line"][:5]):
            move = board.parse_uci(uci)
            key = corpus.board_identity(board)
            if ply % 2 == 0 and key not in boards and fork_squares(board, move):
                usable = True
                yield dict(id=f'fork-puzzle-{row["id"]}-{ply}', game=row["game"],
                           boardKey=key, fen=board.fen(), move=move.uci(),
                           origin="solution", tagged="fork" in row["tags"])
                boards.add(key)
                break
            board.push(move)
        if not usable or int.from_bytes(payoff.key(row["game"])[:2], "big") % 3:
            continue
        # Same-game alternative is a hard control. Its geometry and the
        # capture of its forker qualify it, regardless of the source tag.
        start = chess.Board(row["fen"])
        key = corpus.board_identity(start)
        if key in boards:
            continue
        moves = [move for move in start.legal_moves if move.uci() != row["line"][0]
                 and fork_squares(start, move)]
        if moves:
            move = min(moves, key=lambda option: payoff.key(row["game"] + option.uci()))
            yield dict(id=f'fork-puzzle-{row["id"]}-alternative', game=row["game"],
                       boardKey=key, fen=start.fen(), move=move.uci(), origin="alternative",
                       tagged="fork" in row["tags"])
            boards.add(key)


def preview_one(engine, case):
    board = chess.Board(case["fen"])
    move = board.parse_uci(case["move"])
    targets = fork_squares(board, move)
    board.push(move)
    lines = payoff.search(engine, board, PREVIEW_NODES)
    if not lines:
        return
    main = board.parse_uci(lines[0]["pv"][0])
    if main.to_square != move.to_square or main.from_square not in targets or not board.is_capture(main):
        return
    if case["origin"] == "alternative":
        return dict(case, stratum="alternative")
    if len(lines) >= 2 and len(lines[1]["pv"]) >= 2:
        second = chess.Move.from_uci(lines[1]["pv"][1])
        if second.from_square == move.to_square and second.to_square in targets:
            return dict(case, stratum="answer-cost")
    return dict(case, stratum="other-first-defence")


def measured(engine, board, nodes, count, root_moves=None):
    reducer = payoff.engine_tools.CompleteVariations(board, count)
    engine.configure({"Clear Hash": None})
    with engine.analysis(board, chess.engine.Limit(nodes=nodes), multipv=count, root_moves=root_moves) as analysis:
        for info in analysis:
            reducer.add(info)
    return [dict(fen=board.fen(), depth=row["depth"], nodes=row["nodes"], cp=row["score"].relative.score(),
                 mate=row["score"].relative.mate(), pvUci=[move.uci() for move in row["pv"]])
            for row in reducer.best or []]


def deep_one(engine, case):
    board = chess.Board(case["fen"])
    move = board.parse_uci(case["move"])
    root = measured(engine, board, ROOT_NODES, 1, [move])
    board.push(move)
    replies = measured(engine, board, REPLY_NODES, min(3, board.legal_moves.count()))
    return dict(case, paired=root, withReplies=[dict(moveUci=case["move"], lines=replies)])


def batch_search(task):
    executable, rows, preview = task
    evaluate = preview_one if preview else deep_one
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        return [result for row in rows if (result := evaluate(engine, row)) is not None]


def search(executable, cases, preview, workers):
    tasks = [(str(executable), cases[i:i + 12], preview) for i in range(0, len(cases), 12)]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return [row for block in pool.map(batch_search, tasks) for row in block]


def write(path, data):
    with path.open("x", encoding="utf-8") as file:
        json.dump(data, file, indent=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("preview", "deep"))
    parser.add_argument("input", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exclude", type=Path, nargs="*", default=[])
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    start = perf_counter()
    data = payoff.read(args.input)
    if args.mode == "preview":
        excluded = []
        for path in args.exclude:
            payload = payoff.read(path)
            excluded.extend(payload if isinstance(payload, list) else payload["cases"])
        cases = list(propose(data, excluded))
        surfaced = search(args.engine, cases, True, args.workers)
        selected, games, counts = [], set(), Counter()
        quotas = {"answer-cost": 36, "other-first-defence": 18, "alternative": 18}
        for row in sorted(surfaced, key=lambda item: payoff.key(item["id"])):
            key = row["stratum"]
            if row["game"] in games or counts[key] >= quotas[key]:
                continue
            games.add(row["game"])
            counts[key] += 1
            selected.append(row)
        result = dict(previewNodes=PREVIEW_NODES, screened=len(cases), surfaced=len(surfaced),
                      counts=counts, cases=selected)
    else:
        result = dict(rootNodes=ROOT_NODES, replyNodes=REPLY_NODES,
                      cases=search(args.engine, data["cases"], False, args.workers))
    result["engineSha256"] = hashlib.sha256(args.engine.read_bytes()).hexdigest()
    result["inputSha256"] = hashlib.sha256(args.input.read_bytes()).hexdigest()
    result["durationSeconds"] = perf_counter() - start
    write(args.output, result)
    print({key: value for key, value in result.items() if key != "cases"}, flush=True)


if __name__ == "__main__":
    main()
