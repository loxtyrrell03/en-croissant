"""Collect an independent challenge of checks near the end of real games."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.pgn


def main():
    work, exe, previous = map(Path, sys.argv[1:])
    source = Path("benchmarks/decision-evidence/opened-rook-file/prepare.py").resolve()
    spec = importlib.util.spec_from_file_location("matched_engine", source)
    study = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(study)
    exclusions = []
    for path in (work / "public-input.json", work / "fresh-input.json", previous):
        exclusions.extend(json.loads(path.read_bytes()))
    visited = {study.sampling.board_key(row["fen"]) for row in exclusions}
    seen_games = {row.get("sourceGroup") for row in exclusions}
    rows, manifest = [], {}
    for event in ("bihar", "freiburg", "almaty-masters", "poland-semifinal"):
        path = work / (event + ".pgn")
        valid_games = study.sampling.read_games(path, visited)
        shortlist = {}
        with path.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                board = game.board()
                if game.errors or game.headers.get("Result") not in ("1-0", "0-1"):
                    continue
                moves = list(game.mainline_moves())
                key = study.sampling.digest((study.sampling.board_key(board.fen()) +
                        " " + " ".join(move.uci() for move in moves)).encode())
                if key not in valid_games:
                    continue
                phases = {x["ply"]: x for x in valid_games[key]}
                # Endgame phase caps normally exclude the last plies. Here
                # the game is already validated; use real boards 6-24 plies
                # before the finish, where the player still has a choice.
                checks, positions = [], []
                for move in moves:
                    positions.append((board.ply(), board.fen(), board.is_check(), board.legal_moves.count()))
                    board.push(move)
                    checks.append(board.is_check())
                for i in range(max(16, len(moves) - 24), len(moves) - 5):
                    ply, fen, currently_checked, legal = positions[i]
                    line = checks[i:i+5]
                    if legal < 2 or max(sum(line[0::2]), sum(line[1::2])) < 2:
                        continue
                    if study.sampling.board_key(fen) in visited:
                        continue
                    shortlist.setdefault(key, []).append(
                        phases.get(ply, {"ply": ply, "fen": fen, "phase": "endgame", "playedMoveUci": moves[i].uci()}))
        picked = study.sampling.select_event(event, shortlist, 7, 0, visited, seen_games)
        rows.extend(picked)
        manifest[event] = {"positions": len(picked), "pgnSha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    study.write_new(work/"mate-holdout-sample.json", {"cases":rows,"events":manifest})
    print(manifest,flush=True)
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(study.examine, ((row,exe) for row in rows)))
    study.write_new(work/"mate-holdout-engine.json",results)


if __name__ == "__main__":
    main()
