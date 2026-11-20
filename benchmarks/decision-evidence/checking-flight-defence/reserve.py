"""Freeze public decisions using geometry before opening Stockfish outcomes."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn

from probe import (
    BUCKETS, HERE, candidate_checks, engines, exact, passed, push, relative_rank, search,
)

sys.path.insert(0, str(HERE.parent / "neural-deep-witness"))
from frames import family, game_key
from sample import board_key, classical_sources


SLIDERS = (chess.BISHOP, chess.ROOK, chess.QUEEN)


def geometry(board, actual, *, pin=False):
    if board.piece_type_at(actual.from_square) not in SLIDERS or board.is_capture(actual) or board.gives_check(actual):
        return None
    enemy = not board.turn
    passers = [square for square in board.pieces(chess.PAWN, enemy)
               if relative_rank(square, enemy) == 5 and passed(board, square, enemy)]
    if not passers:
        return None
    after_actual = push(board, actual)
    alternatives = [move for move in board.generate_legal_moves(from_mask=chess.BB_SQUARES[actual.from_square])
                    if move != actual and not board.is_capture(move) and not board.gives_check(move)]
    if not alternatives:
        return None
    control = False
    for square in passers:
        advance = chess.Move(square, square + (8 if enemy else -8))
        if advance not in after_actual.legal_moves:
            continue
        after_weak = push(after_actual, advance)
        if not any(after_weak.gives_check(move) for move in after_weak.legal_moves):
            continue
        control = True
        for alternative in alternatives:
            other = push(board, alternative)
            if advance in other.legal_moves and candidate_checks(push(other, advance), after_weak, alternative.to_square):
                return (alternative, advance) if pin else "geometry"
    return "control" if control and not pin else None


def frozen(lab, n):
    exclude = (*BUCKETS, "paired-passer-benchmark/sample.json")
    seen_boards, seen_games, seen_sites = set(), set(), set()
    hashes = {}
    for name in exclude:
        raw = (lab / name).read_bytes()
        hashes[name] = sha256(raw).hexdigest()
        frame = json.loads(raw)
        rows = frame if isinstance(frame, list) else [row for group in frame.values() for row in group]
        seen_games.update(game_key(r) for r in rows if r.get("history") and len(r["history"]["moves"]) >= 24)
        seen_boards.update(board_key(chess.Board(r["fen"])) for r in rows)
        seen_sites.update(r["site"] for r in rows if r.get("site"))
    pools = defaultdict(list)
    for file, (event, fallback) in sorted(classical_sources(lab).items(), key=lambda item: (item[1], item[0].name)):
        if "lugano" in event:
            continue
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*" or game.headers.get("Site") in seen_sites:
                    continue
                board = game.board()
                moves = [m.uci() for m in game.mainline_moves()]
                identity = game_key({"history": {"fen": board.fen(), "moves": moves}})
                if identity in seen_games or len(moves) < 48:
                    continue
                seen_games.add(identity)
                rows = []
                for i, token in enumerate(moves[:-3]):
                    move = board.parse_uci(token)
                    if i >= 36 and len(board.piece_map()) <= 22:
                        arm = geometry(board, move)
                        if arm and board_key(board) not in seen_boards and not board.is_game_over(claim_draw=True):
                            seed = sha256(f"checking-flight-v1:{identity}:{i}".encode()).hexdigest()
                            rows.append((arm != "geometry", seed, i, board.fen(), arm))
                    board.push(move)
                if not rows:
                    continue
                _, seed, ply, fen, arm = min(rows)
                seen_boards.add(board_key(chess.Board(fen)))
                site = game.headers.get("Site", "")
                pools[(arm, family(event))].append({
                    "id": "checking-flight-" + seed[:16], "fen": fen,
                    "history": {"fen": game.board().fen(), "moves": moves[:ply]},
                    "playedMoveUci": moves[ply], "site": site if site.startswith("https://lichess.org/broadcast/") else fallback,
                    "cohort": arm, "event": family(event), "game": identity,
                })
    for rows in pools.values():
        rows.sort(key=lambda row: row["id"])
    output = []
    for arm in ("geometry", "control"):
        keys = sorted(key for key in pools if key[0] == arm)
        ranked = [
            pools[key][i] for i in range(max((len(pools[key]) for key in keys), default=0))
            for key in keys if i < len(pools[key])
        ]
        output.extend(ranked[:n])
    return output, hashes


def score(row, engine):
    board = exact(row)
    roots = search(board, engine, 1200000, min(3, board.legal_moves.count()))["lines"]
    result = dict(row, candidates=roots, replyProbes=[])
    if (not roots or roots[0]["pvUci"][0] == row["playedMoveUci"]
            or roots[0]["pvUci"][0][:2] != row["playedMoveUci"][:2]):
        return dict(result, status="no-related-leading-choice")
    played = board.parse_uci(row["playedMoveUci"])
    better = board.parse_uci(roots[0]["pvUci"][0])
    pair = search(board, engine, 1800000, 2, [played, better])["lines"]
    if len(pair) != 2 or pair[0]["pvUci"][0] != better.uci():
        return dict(result, status="pair-reversed")
    child = push(board, played)
    replies = search(child, engine, 1000000, min(3, child.legal_moves.count()))["lines"]
    return dict(result, comparisonCandidates=pair, replyProbes=[{"moveUci": played.uci(), "lines": replies}],
                status="scored")


def geometry_score(row, engine):
    board = exact(row)
    played = board.parse_uci(row["playedMoveUci"])
    shapes = geometry(board, played, pin=True)
    if not shapes:
        return dict(row, status="no-geometric-alternative")
    alternative, advance = shapes
    pair = search(board, engine, 1800000, 2, [played, alternative])["lines"]
    if len(pair) != 2 or pair[0]["pvUci"][0] != alternative.uci():
        return dict(row, comparisonCandidates=pair, status="geometry-does-not-improve")
    reached = push(board, played)
    response = search(reached, engine, 1000000, 1, [advance])["lines"]
    return dict(row, candidates=pair, comparisonCandidates=pair,
                replyProbes=[{"moveUci": played.uci(), "lines": response}], status="geometry-is-better")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    freeze = subs.add_parser("freeze")
    for name in ("lab", "output", "manifest"):
        freeze.add_argument(name, type=Path)
    freeze.add_argument("--quota", type=int, default=64)
    analyse = subs.add_parser("score")
    for name in ("input", "engine", "output"):
        analyse.add_argument(name, type=Path)
    analyse.add_argument("--geometry-only", action="store_true")
    args = parser.parse_args()
    if args.command == "freeze":
        rows, manifest = frozen(args.lab, args.quota)
        with args.manifest.open("x", encoding="utf-8") as out:
            json.dump(manifest, out, indent=2)
    else:
        source = json.loads(args.input.read_bytes())
        analyse_position = geometry_score if args.geometry_only else score
        try:
            with ThreadPoolExecutor(7) as pool:
                rows = list(pool.map(lambda row: analyse_position(row, str(args.engine)), source))
        finally:
            for engine in engines:
                engine.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(rows, out, separators=(",", ":"))
        out.write("\n")
    print(dict(Counter(row.get("status", row["cohort"]) for row in rows)),
          len({row["event"] for row in rows}), "event families", sha256(args.output.read_bytes()).hexdigest(), flush=True)


if __name__ == "__main__":
    main()
