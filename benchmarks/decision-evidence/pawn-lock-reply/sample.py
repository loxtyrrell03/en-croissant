"""Select one board per game from previously untested classical events."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

EVENTS = ("skakligaen", "eliteserien", "asian_para", "hjorth")


def load_previous_study():
    src = Path("benchmarks/decision-evidence/opened-rook-file/prepare.py").resolve()
    spec = importlib.util.spec_from_file_location("prepared", src)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def nominate(study, engine, boards):
    """Cheap, classifier-independent preview of candidate response differences."""
    with chess.engine.SimpleEngine.popen_uci(engine) as uci:
        uci.configure({"Threads": 1, "Hash": 16})
        out = []
        for row in boards:
            board = chess.Board(row["fen"])
            roots, _ = study.search.search_replies(uci, board, 3, 28_000)
            best = roots[0]
            if best["mate"] is not None or abs(best["cp"]) > 800 or len(best["pvUci"]) < 3:
                continue
            board.push_uci(best["pvUci"][0])
            if board.legal_moves.count() < 2:
                continue
            replies, _ = study.search.search_replies(uci, board, 2, 32_000)
            leader, other = replies
            if other["cp"] is None or leader["cp"] is None:
                continue
            delta = leader["cp"] - other["cp"]
            prospective = chess.Move.from_uci(other["pvUci"][0])
            if 85 <= delta <= 400 and (board.is_capture(prospective) or board.gives_check(prospective)):
                out.append((delta, row))
        return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("work", type=Path)
    p.add_argument("engine", type=Path)
    p.add_argument("previous", type=Path, nargs="+")
    args = p.parse_args()
    s = load_previous_study()
    seen = [row for file in args.previous for row in json.loads(file.read_bytes())]
    seen_boards = {s.sampling.board_key(row["fen"]) for row in seen}
    seen_games = {row.get("sourceGroup") for row in seen}
    candidates, routine, metadata = {}, [], {}
    for event in EVENTS:
        source = args.work / (event + ".pgn")
        games = s.sampling.read_games(source, seen_boards)
        candidates[event] = games
        routine += s.sampling.select_event(event, games, 6, 0, seen_boards, seen_games)
        metadata[event] = {"pgnSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "games": len(games)}

    # The ordinary cases are selected without any engine or classifier score.
    work = []
    for event, games in candidates.items():
        for game in sorted(set(games) - seen_games):
            eligible = sorted(games[game], key=lambda row: hashlib.sha256(row["fen"].encode()).digest())[:4]
            for row in eligible:
                row.update(event=event, stratum="tempting-response", sourceGroup=game)
            work.append(eligible)

    previewed = []
    with ThreadPoolExecutor(6) as pool:
        for results in pool.map(lambda group: nominate(s, args.engine, group), work):
            previewed.extend(results)
    challenge = []
    for _, row in sorted(previewed, key=lambda pair: (
            -pair[0], hashlib.sha256(pair[1]["fen"].encode()).digest())):
        game, board = row["sourceGroup"], s.sampling.board_key(row["fen"])
        if game in seen_games or board in seen_boards:
            continue
        if sum(item["event"] == row["event"] for item in challenge) >= 5:
            continue
        seen_games.add(game)
        seen_boards.add(board)
        case = dict(row)
        case["id"] = f"tournament-{row['event']}-{game.removeprefix('sha256:')[:16]}-{row['ply']}"
        challenge.append(case)
    cases = routine + challenge
    s.write_new(args.work / "heldout-sample.json", {"cases": cases, "sources": metadata})
    print("Frozen", len(routine), "ordinary and", len(challenge), "challenge", metadata, flush=True)
    results = []
    with ThreadPoolExecutor(4) as pool:
        for row in pool.map(s.examine, ((row, args.engine) for row in cases)):
            results.append(row)
            if len(results) % 8 == 0:
                print("Analysed", len(results), "/", len(cases), flush=True)
    s.write_new(args.work / "heldout-engine.json", results)


if __name__ == "__main__":
    main()
