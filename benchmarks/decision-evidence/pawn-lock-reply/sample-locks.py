"""Find public pawn-fixation examples systematically in played games."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path

import chess
import chess.pgn

from sample import load_previous_study

EVENTS = ("mongolia", "baden", "amazonas", "kardzhali", "bundesliga")


def played_locks(study, source, eligible):
    result = dict(attacking={}, ordinary={})
    with source.open(encoding="utf-8-sig") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            start = game.board()
            if game.errors or not start.is_valid():
                continue
            moves = list(game.mainline_moves())
            signature = study.sampling.board_key(start.fen()) + " " + " ".join(move.uci() for move in moves)
            key = study.sampling.digest(signature.encode())
            if key not in eligible:
                continue
            by_ply = {row["ply"]: row for row in eligible[key]}
            for move in moves:
                board = start
                piece = board.piece_at(move.from_square)
                ahead = move.to_square + (8 if board.turn else -8)
                if (board.ply() in by_ply and piece.piece_type == chess.PAWN and not board.is_capture(move)
                        and not move.promotion and not board.is_check() and 0 <= ahead < 64
                        and board.piece_at(ahead) == chess.Piece(chess.PAWN, not board.turn)):
                    rank = chess.square_rank(move.to_square)
                    if (rank >= 3 if board.turn else rank <= 4):
                        threats = chess.BB_PAWN_ATTACKS[board.turn][move.to_square] & board.occupied_co[not board.turn]
                        pieces = threats & ~board.pawns & ~board.kings
                        stratum = "attacking" if pieces else "ordinary"
                        row = dict(by_ply[board.ply()], stratum=stratum)
                        result[stratum].setdefault(key, []).append(row)
                start.push(move)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("previous", type=Path, nargs="+")
    args = parser.parse_args()
    study = load_previous_study()
    seen = [row for filename in args.previous for row in json.loads(filename.read_bytes())]
    exclusions = {study.sampling.board_key(row["fen"]) for row in seen}
    games_seen = {row.get("sourceGroup") for row in seen}
    used_boards = set(exclusions)
    cases, metadata = [], {}
    for event in EVENTS:
        source = args.work / f"{event}.pgn"
        if not source.exists():
            continue
        games = study.sampling.read_games(source, exclusions)
        groups = played_locks(study, source, games)
        counts = {}
        for stratum, boards in groups.items():
            picked = study.sampling.select_event(event, boards, 5 if stratum == "attacking" else 3,
                                                  0, used_boards, games_seen)
            for row in picked:
                row["stratum"] = stratum
            counts[stratum] = len(picked)
            cases.extend(picked)
        metadata[event] = dict(pgnSha256=hashlib.sha256(source.read_bytes()).hexdigest(), counts=counts)
    study.write_new(args.work / "locks-sample.json", {"cases": cases, "sources": metadata})
    print("Frozen", len(cases), metadata, flush=True)
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(study.examine, ((row, args.engine) for row in cases)))
    study.write_new(args.work / "locks-engine.json", results)


if __name__ == "__main__":
    main()
