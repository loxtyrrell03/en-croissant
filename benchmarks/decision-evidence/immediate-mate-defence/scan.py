"""Find pre-existing mating threats in classical games without classifier output."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn


def mates(board):
    options = []
    for move in list(board.legal_moves):
        board.push(move)
        if board.is_checkmate():
            options.append(move.uci())
        board.pop()
    return options


def scan_event(path, event, sampling, earlier):
    challenge, ordinary = {}, {}
    total_games = 0
    positions = 0
    with path.open(encoding="utf-8-sig") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            root = game.board()
            if game.errors or root.fen() != chess.STARTING_FEN:
                continue
            if game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                continue
            moves = list(game.mainline_moves())
            key = sampling.digest((sampling.board_key(root.fen()) +
                                   " " + " ".join(move.uci() for move in moves)).encode())
            if key in earlier:
                continue
            total_games += 1
            for index, move in enumerate(moves):
                fen = root.fen()
                checked = root.is_check()
                count = root.legal_moves.count()
                checking = root.gives_check(move)
                candidate = index >= 20 and count > 1 and not checked
                threats = []
                if candidate:
                    positions += 1
                    root.push(chess.Move.null())
                    threats = mates(root)
                    root.pop()
                root.push(move)
                if not candidate:
                    continue
                # The scan nominates positions by the actual game, independent of
                # the later Stockfish choice and the app's available evidence.
                if threats and not checking and not root.is_game_over() and not mates(root):
                    stratum = "recorded-defence"
                    destination = challenge
                elif threats:
                    continue
                else:
                    stratum = "ordinary"
                    destination = ordinary
                destination.setdefault(key, []).append({
                    "fen": fen, "ply": index, "playedMoveUci": move.uci(),
                    "phase": "early-middlegame" if index < 45 else "late-game",
                    "stratum": stratum, "recordedThreatUci": threats,
                    "sourceGroup": key, "event": event,
                    "id": f"mate-defence-{event}-{key[:16]}-{index}",
                })
    metadata = {"games": total_games, "positions": positions, "defenceGames": len(challenge)}
    return challenge, ordinary, metadata


def choose(candidates, count, salt, seen, sampling):
    order = lambda value: hashlib.sha256(f"{salt}:{value}".encode()).digest()
    result = []
    for key in sorted(candidates, key=order):
        if len(result) >= count:
            break
        if key in seen:
            continue
        row = min(candidates[key], key=lambda item: order(item["id"]))
        board_key = sampling.board_key(row["fen"])
        if board_key in seen:
            continue
        seen.update((key, board_key))
        result.append(row)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("events", nargs="+", type=Path)
    parser.add_argument("--previous", nargs="+", type=Path, required=True)
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--defences", type=int, default=6)
    parser.add_argument("--controls", type=int, default=6)
    args = parser.parse_args()
    source = Path("benchmarks/decision-evidence/opened-rook-file/prepare.py").resolve()
    spec = importlib.util.spec_from_file_location("decision_prepare", source)
    study = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(study)
    sampler = study.sampling
    prior = [row for path in args.previous for row in json.loads(path.read_bytes())]
    seen = {sampler.board_key(row["fen"]) for row in prior}
    seen.update(row.get("sourceGroup") for row in prior)
    rows, events = [], {}
    for path in args.events:
        event = path.stem
        challenge, ordinary, sweep = scan_event(path, event, sampler, seen)
        positive = choose(challenge, args.defences, "already-threatened-0", seen, sampler)
        control = choose(ordinary, args.controls, "ordinary-no-threat-0", seen, sampler)
        sweep.update({"selectedDefence": len(positive), "selectedOrdinary": len(control),
                      "pgnSha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        print(event, sweep, flush=True)
        rows.extend(positive + control)
        events[event] = sweep
    study.write_new(args.output / "sample.json", {"events": events, "cases": rows})
    if args.engine:
        findings = []
        with ThreadPoolExecutor(5) as pool:
            for result in pool.map(study.examine, ((row, args.engine) for row in rows)):
                findings.append(result)
                if len(findings) % 8 == 0:
                    print("Analysed", len(findings), flush=True)
        study.write_new(args.output / "engine.json", findings)


if __name__ == "__main__":
    main()
