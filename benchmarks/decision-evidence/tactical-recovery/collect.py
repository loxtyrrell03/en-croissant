"""Sample actual classical decisions by shared-capture geometry before analysis."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn


def load_sampler():
    path = Path("benchmarks/decision-evidence/played-immediate-mate/collect.py")
    spec = importlib.util.spec_from_file_location("played_sampler", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def victim(board, played, reply):
    child = board.copy(stack=False)
    child.push(played)
    if reply not in child.legal_moves or not child.is_capture(reply):
        return None, None
    square = reply.to_square
    if child.is_en_passant(reply):
        square += -8 if child.turn else 8
    origin = played.from_square if played.to_square == square else square
    return origin, child.piece_at(square)


def opportunity(before, move, response):
    origin, piece = victim(before, move, response)
    if piece is None:
        return None
    actual = before.copy(stack=False)
    actual.push(move)
    actual.push(response)
    side = before.turn
    good_options = []
    if actual.is_check():
        king = before.king(side)
        zone = chess.BB_KING_ATTACKS[king] | chess.BB_SQUARES[king]
        target = "escape-square"
        lost_moves = set(actual.generate_legal_moves(chess.BB_SQUARES[actual.king(side)]))
        for alternative in before.generate_legal_moves(zone):
            if alternative == move or victim(before, alternative, response) != (origin, piece):
                continue
            child = before.copy(stack=False)
            child.push(alternative)
            child.push(response)
            if child.is_check() and any(reply not in lost_moves
                                       for reply in child.generate_legal_moves(chess.BB_SQUARES[child.king(side)])):
                good_options.append(alternative.uci())
    elif piece.piece_type > chess.PAWN:
        pinned = [square for role in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
                  for square in actual.pieces(role, side) if actual.is_pinned(side, square)]
        if not pinned:
            return None
        target = "unpin"
        king = before.king(side)
        for alternative in before.generate_legal_moves(chess.BB_SQUARES[king]):
            if alternative == move or victim(before, alternative, response) != (origin, piece):
                continue
            child = before.copy(stack=False)
            child.push(alternative)
            child.push(response)
            for square in pinned:
                if child.piece_at(square) != actual.piece_at(square) or child.is_pinned(side, square):
                    continue
                # Enrichment uses mobility and geometry only. The release
                # candidate still needs independent searches and material evidence.
                moves = child.generate_legal_moves(chess.BB_SQUARES[square])
                if any(reply not in actual.legal_moves for reply in moves):
                    good_options.append(alternative.uci())
                    break
    return (target, sorted(good_options)) if good_options else None


def sample_event(path, paired, seen, quota):
    sampler, draw = paired.develop.sampling, paired.verifier.choose
    entries = {kind: {} for kind in ("escape-square", "unpin", "ordinary")}
    games = 0
    with path.open(encoding="utf-8-sig") as stream:
        while (game := chess.pgn.read_game(stream)) is not None:
            board = game.board()
            if game.errors or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
                continue
            if board.fen() != chess.STARTING_FEN:
                continue
            moves = list(game.mainline_moves())
            signature = sampler.board_key(board.fen()) + " " + " ".join(move.uci() for move in moves)
            key = sampler.digest(signature.encode())
            if key in seen:
                continue
            games += 1
            for ply, original in enumerate(moves):
                if ply >= 20 and ply + 10 < len(moves) and not board.is_game_over():
                    fen = board.fen()
                    if sampler.board_key(fen) not in seen:
                        found = opportunity(board, original, moves[ply + 1])
                        stratum, alternatives = found or ("ordinary", [])
                        entries[stratum].setdefault(key, []).append({
                            "id": f"recovery-{path.stem}-{key[:16]}-{ply}",
                            "event": path.stem, "stratum": stratum,
                            "fen": fen, "sourceGroup": key, "ply": ply,
                            "playedMoveUci": original.uci(), "gameReplyUci": moves[ply + 1].uci(),
                            "geometricAlternatives": alternatives,
                            "history": {"fen": chess.STARTING_FEN, "moves": [m.uci() for m in moves[:ply]]},
                        })
                board.push(original)
    picks = []
    for kind, seats in zip(entries, quota, strict=True):
        picks.extend(draw(entries[kind], seats, "joint-capture-resource-0", seen, sampler))
    return picks, {
        "games": games, "pool": {key: len(bucket) for key, bucket in entries.items()},
        "picked": {key: sum(row["stratum"] == key for row in picks) for key in entries},
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("events", type=Path, nargs="+")
    parser.add_argument("--previous", type=Path, nargs="+", required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--quota", nargs=3, type=int, default=(7, 7, 4))
    args = parser.parse_args()
    paired = load_sampler()
    archived = [row for path in args.previous for row in json.loads(path.read_bytes())]
    seen = {paired.develop.sampling.board_key(row["fen"]) for row in archived}
    seen.update(row.get("sourceGroup") for row in archived)
    test_cases, metadata = [], {}
    for path in args.events:
        rows, meta = sample_event(path, paired, seen, args.quota)
        metadata[path.stem] = meta
        test_cases.extend(rows)
        print(path.stem, meta, flush=True)
    paired.develop.write_new(args.directory / "sample.json", {"cases": test_cases, "events": metadata})
    results = []
    with ThreadPoolExecutor(5) as pool:
        for row in pool.map(paired.analyse, ((row, args.engine) for row in test_cases)):
            results.append(row)
            if len(results) % 8 == 0:
                print("Analysed", len(results), flush=True)
    paired.develop.write_new(args.directory / "engine.json", results)


if __name__ == "__main__":
    main()
