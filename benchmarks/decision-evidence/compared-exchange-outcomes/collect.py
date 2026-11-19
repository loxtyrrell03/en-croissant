"""Freeze new game-disjoint exchange cases using only the recorded moves."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn

from screen import sequence, settles


def load_script():
    path = Path("benchmarks/decision-evidence/played-immediate-mate/collect.py")
    spec = importlib.util.spec_from_file_location("paired", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exchange(board, continuation):
    steps = sequence(board, continuation)
    for horizon in range(7, len(steps) + 1):
        if steps[horizon - 1].material > -200 or not settles(steps, horizon):
            continue
        for index in range(3, min(8, horizon - 3), 2):
            if steps[index].capture is None:
                continue
            if all(step.check or step.capture is not None for step in steps[1:index:2]):
                return True
    return False


def sample(path, paired, seen, quota, first_round=None):
    sampler, pick = paired.develop.sampling, paired.verifier.choose
    exchanges, ordinary = {}, {}
    with path.open(encoding="utf-8-sig") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            board = game.board()
            if game.errors or board.fen() != chess.STARTING_FEN:
                continue
            if game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                continue
            if first_round is not None:
                round_number = game.headers.get("Round", "").split(".", 1)[0]
                if not round_number.isdigit() or int(round_number) < first_round:
                    continue
            moves = [move.uci() for move in game.mainline_moves()]
            key = sampler.digest((sampler.board_key(board.fen()) + " " + " ".join(moves)).encode())
            if key in seen:
                continue
            for ply, move in enumerate(moves):
                if ply >= 20 and ply + 12 < len(moves) and board.legal_moves.count() > 1:
                    fen = board.fen()
                    if sampler.board_key(fen) not in seen:
                        has_exchange = exchange(board, moves[ply:ply + 13])
                        kind = "recorded-exchange" if has_exchange else "ordinary"
                        bucket = exchanges if has_exchange else ordinary
                        bucket.setdefault(key, []).append({
                            "id": f"exchange-{path.stem}-{key[:16]}-{ply}", "event": path.stem,
                            "ply": ply, "stratum": kind, "sourceGroup": key, "fen": fen,
                            "playedMoveUci": move,
                            "history": {"fen": chess.STARTING_FEN, "moves": moves[:ply]},
                        })
                board.push_uci(move)
    sample = pick(exchanges, quota[0], "matched-early-material-0", seen, sampler)
    control = pick(ordinary, quota[1], "ordinary-matched-early-material-0", seen, sampler)
    return sample + control, {
        "selectedExchange": len(sample), "selectedOrdinary": len(control),
        "exchangeGames": len(exchanges), "ordinaryGames": len(ordinary),
        "firstRound": first_round,
        "pgnSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("events", type=Path, nargs="+")
    parser.add_argument("--previous", type=Path, nargs="+", required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--quota", type=int, nargs=2, default=(6, 6))
    parser.add_argument("--karlstad-classical", action="store_true")
    args = parser.parse_args()
    paired = load_script()
    previous = [row for path in args.previous for row in json.loads(path.read_bytes())]
    seen = {paired.develop.sampling.board_key(row["fen"]) for row in previous}
    seen.update(row.get("sourceGroup") for row in previous)
    records, protocol = [], {}
    for path in args.events:
        first_round = 3 if args.karlstad_classical and path.stem == "karlstad" else None
        rows, meta = sample(path, paired, seen, args.quota, first_round)
        protocol[path.stem] = meta
        print(path.stem, meta, flush=True)
        records.extend(rows)
    paired.develop.write_new(args.directory / "sample.json", {"cases": records, "events": protocol})
    engine = []
    with ThreadPoolExecutor(5) as pool:
        for row in pool.map(paired.analyse, ((row, args.engine) for row in records)):
            engine.append(row)
            if len(engine) % 8 == 0:
                print("Analysed", len(engine), flush=True)
    paired.develop.write_new(args.directory / "engine.json", engine)


if __name__ == "__main__":
    main()
