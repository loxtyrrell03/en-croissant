"""Sample scored classical boards after freezing a legal shape and ordinary controls."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.pgn

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "strategic-choice-contrast"))
from audit_split import normalized_family
from transfer import frames, initial
from search import engines, search

spec = importlib.util.spec_from_file_location(
    "public_games", HERE.parent / "reply-search-allocation" / "sample.py"
)
public_games = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public_games)
board_key, classical_sources = public_games.board_key, public_games.classical_sources


def fingerprint(game):
    return frames.game_key({"history": {
        "fen": game.board().fen(), "moves": [m.uci() for m in game.mainline_moves()],
    }})


def excluded_families(sources, development, boards):
    ranks = defaultdict(set)
    for case in development:
        pos = chess.Board(boards[case["id"]]["fen"])
        ranks[pos.ply()].add(board_key(pos))
    used = {normalized_family(x["event"]) for x in development if x.get("event")}
    for path, (event, _) in sources.items():
        family = normalized_family(event)
        if family in used:
            continue
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                pos = game.board()
                for move in game.mainline_moves():
                    exact = ranks.get(pos.ply())
                    if exact and board_key(pos) in exact:
                        used.add(family)
                        break
                    pos.push(move)
                if family in used:
                    break
    return used


def material_targets(board, move):
    # Sampling only. The later check must pass a legal exchange proof.
    pos = board.copy(stack=False)
    pos.push(move)
    result = set()
    for reply in pos.generate_legal_captures():
        target = pos.piece_at(reply.to_square)
        if not target or target.piece_type not in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
            continue
        pos.push(reply)
        if not any(retake.to_square == reply.to_square for retake in pos.generate_legal_captures()):
            result.add(reply.uci())
        pos.pop()
    return result


def shaped(board, recorded):
    if board.is_check() or board.is_capture(recorded):
        return False
    piece = board.piece_type_at(recorded.from_square)
    if piece not in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        return False
    related = [
        move for move in board.generate_legal_moves(from_mask=chess.BB_SQUARES[recorded.from_square])
        if move != recorded and not board.is_capture(move)
        and chess.square_distance(move.to_square, recorded.to_square) <= 2
    ]
    if not related:
        return False
    baseline = material_targets(board, recorded)
    return any(material_targets(board, move) != baseline for move in related)


def position(game, key, blocked):
    board = game.board()
    history = []
    selected = []
    for move in game.mainline_moves():
        if 28 <= board.ply() <= 110 and len(board.piece_map()) >= 10 and not board.is_check():
            canonical = board_key(board)
            if canonical not in blocked:
                loss_shape = shaped(board, move)
                ticket = sha256(f"sibling-refutation-v1:{key}:{board.ply()}".encode()).hexdigest()
                selected.append((
                    not loss_shape, ticket, board.fen(), tuple(history), move.uci(),
                ))
        history.append(move.uci())
        board.push(move)
    if not selected:
        return
    choose_shape = int(key[:2], 16) < 176
    ordinary, seed, fen, line, move = min(selected, key=lambda row: (choose_shape != (not row[0]), row[1]))
    return {
        "id": "sibling-" + seed[:16], "fen": fen, "recordedMove": move, "game": key,
        "history": {"fen": game.board().fen(), "moves": list(line)},
        "stratum": "ordinary" if ordinary else "similar-shape", "cohort": "fresh-classical",
    }


def freeze(lab, archive, development, prior):
    boards = {row["id"]: row for row in archive}
    excluded_boards = {board_key(chess.Board(row["fen"])) for row in [*archive, *prior]}
    seen_games = {frames.game_key(row) for row in [*archive, *prior]
                  if row.get("history") and len(row["history"]["moves"]) >= 24}
    sources = classical_sources(lab)
    exclusion = excluded_families(sources, development, boards)
    pools = defaultdict(list)
    provenance = {}
    for path, (event, reference) in sorted(sources.items(), key=lambda item: (item[1], item[0].name)):
        family = normalized_family(event)
        if family in exclusion:
            continue
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*" or game.end().ply() < 40:
                    continue
                key = fingerprint(game)
                if key in seen_games:
                    continue
                seen_games.add(key)
                row = position(game, key, excluded_boards)
                if not row:
                    continue
                excluded_boards.add(board_key(chess.Board(row["fen"])))
                site = game.headers.get("Site", "")
                local = path.relative_to(lab).as_posix()
                pools[row["stratum"], family].append(dict(
                    row, event=family, source=local,
                    site=site if site.startswith("https://lichess.org/broadcast/") else reference,
                ))
                provenance[local] = sha256(path.read_bytes()).hexdigest()
    sample = []
    for name, count in (("similar-shape", 150), ("ordinary", 90)):
        options = [sorted(rows, key=lambda row: row["id"]) for tag, rows in sorted(pools.items()) if tag[0] == name]
        staggered = [rows[index] for index in range(max(map(len, options), default=0))
                     for rows in options if index < len(rows)]
        sample.extend(staggered[:count])
    manifest = {"excludedEventFamilies": sorted(exclusion),
                "sources": {row["source"]: provenance[row["source"]] for row in sample}}
    return sample, manifest


def roots(row, engine, nodes, reuse_choices=False):
    board = initial(row)
    if board.is_game_over(claim_draw=True):
        return dict(row, candidates=[])
    choices = [board.parse_uci(line["pvUci"][0]) for line in row["candidates"]] if reuse_choices else None
    lines = search(board, engine, nodes, len(choices) if choices else min(3, board.legal_moves.count()), choices)["lines"]
    return dict(row, candidates=lines)


def reply(row, engine, nodes, _reuse_choices=False):
    if not row["candidates"]:
        return row
    move = row["candidates"][0]["pvUci"][0]
    board = initial(row)
    board.push_uci(move)
    if board.is_game_over(claim_draw=True):
        return row
    result = search(board, engine, nodes, min(3, board.legal_moves.count()))["lines"]
    return dict(row, replyProbes=[{"moveUci": move, "lines": result}]) if result else row


def write(path, data):
    with path.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(data, out, separators=(",", ":"))
        out.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    choose = sub.add_parser("freeze")
    for name in ("lab", "archive", "development", "prior", "output", "manifest"):
        choose.add_argument(name, type=Path)
    analyse = sub.add_parser("roots")
    for name in ("input", "engine", "output"):
        analyse.add_argument(name, type=Path)
    analyse.add_argument("--nodes", type=int, default=2_400_000)
    analyse.add_argument("--reuse-choices", action="store_true")
    corroborate = sub.add_parser("reply")
    for name in ("input", "engine", "output"):
        corroborate.add_argument(name, type=Path)
    corroborate.add_argument("--nodes", type=int, default=1_400_000)
    args = parser.parse_args()
    if args.mode == "freeze":
        inputs = (args.archive, args.development, args.prior)
        raw = [p.read_bytes() for p in inputs]
        sample, manifest = freeze(args.lab, *map(json.loads, raw))
        manifest["hashes"] = {path.name: sha256(data).hexdigest() for path, data in zip(inputs, raw)}
        write(args.manifest, manifest)
        rows = sample
    else:
        sample = json.loads(args.input.read_bytes())
        try:
            run = roots if args.mode == "roots" else reply
            with ThreadPoolExecutor(7) as pool:
                rows = list(pool.map(lambda row: run(
                    row, str(args.engine), args.nodes, getattr(args, "reuse_choices", False)
                ), sample))
        finally:
            for worker in engines:
                worker.quit()
    print(Counter(row["stratum"] for row in rows), len({row["event"] for row in rows}), flush=True)
    write(args.output, rows)


if __name__ == "__main__":
    main()
