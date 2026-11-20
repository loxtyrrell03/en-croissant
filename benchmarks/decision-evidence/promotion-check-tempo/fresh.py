"""Freeze separate classical decisions before running either prototype."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "neural-passer-probe"))
from assets import passed, reached, relative_rank
sys.path.insert(0, str(HERE.parent / "neural-deep-witness"))
from frames import family, game_key
from sample import board_key, classical_sources
from search import engines, search


SEED = "promotion-check-tempo-1"
QUOTA = 144


def hashed(*parts):
    return sha256(":".join((SEED, *map(str, parts))).encode()).hexdigest()


def pick(game, fingerprint):
    board = game.board()
    possibilities, history = [], []
    nodes = list(game.mainline())
    for i, node in enumerate(nodes[:-5]):
        if (
            i >= 32 and len(board.piece_map()) <= 20
            and any(board.pieces(piece, not board.turn) for piece in (chess.ROOK, chess.BISHOP, chess.QUEEN))
        ):
            candidates = [p for p in board.pieces(chess.PAWN, board.turn)
                          if relative_rank(p, board.turn) >= 4 and passed(board, p, board.turn)]
            if candidates and any(
                board.piece_type_at(move.from_square) == chess.KING
                and move != node.move and not board.is_capture(move) and not board.is_castling(move)
                for move in board.legal_moves
            ):
                active = max(relative_rank(p, board.turn) for p in candidates)
                king_move = board.piece_type_at(node.move.from_square) == chess.KING
                token = hashed(fingerprint, i)
                possibilities.append(((not king_move, -active, token), i, board.fen(), node.move.uci()))
        history.append(node.move.uci())
        board.push(node.move)
    if not possibilities:
        return None
    (_, _, token), ply, fen, uci = min(possibilities)
    return {
        "id": "fresh-king-" + token[:16], "game": fingerprint, "fen": fen, "playedMoveUci": uci,
        "history": {"fen": game.board().fen(), "moves": history[:ply]},
    }


def freeze(lab):
    sources = classical_sources(lab)
    block_games, block_boards = set(), set()
    phases = (
        "paired-passer-benchmark/sample.json", "reply-coverage-audit/full-pair-input.json",
        "reply-concordance/reserve-scored.json", "alternate-capture-payoff/fresh-scored.json",
        "played-mate-in-three/reserve-scored.json",
    )
    manifest = {}
    for relative in phases:
        raw = (lab / relative).read_bytes()
        value = json.loads(raw)
        records = value if isinstance(value, list) else [row for group in value.values() for row in group]
        block_games.update(game_key(row) for row in records
                           if row.get("history") and len(row["history"]["moves"]) >= 24)
        block_boards.update(board_key(chess.Board(row["fen"])) for row in records)
        manifest[relative] = sha256(raw).hexdigest()
    by_family = defaultdict(list)
    for path, (event, fallback) in sorted(sources.items(), key=lambda item: (item[1], item[0].name)):
        if "hoogeveen" in event:
            continue
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                fingerprint = game_key({"history": {
                    "fen": game.board().fen(), "moves": [m.uci() for m in game.mainline_moves()],
                }})
                if fingerprint in block_games:
                    continue
                block_games.add(fingerprint)
                row = pick(game, fingerprint)
                if not row or (identity := board_key(chess.Board(row["fen"]))) in block_boards:
                    continue
                if reached(row).is_game_over(claim_draw=True):
                    continue
                block_boards.add(identity)
                site = game.headers.get("Site", "")
                event_family = family(event)
                by_family[event_family].append(dict(
                    row, event=event_family, cohort="fresh",
                    site=site if site.startswith("https://lichess.org/broadcast/") else fallback,
                ))
    for rows in by_family.values():
        rows.sort(key=lambda row: row["id"])
    choices = []
    for index in range(max(map(len, by_family.values()), default=0)):
        for event in sorted(by_family, key=hashed):
            if index >= len(by_family[event]):
                continue
            choices.append(by_family[event][index])
            if len(choices) >= QUOTA:
                return choices, manifest
    raise ValueError(f"Only {len(choices)} eligible public games")


def score(row, engine, root_nodes, reply_nodes):
    board = reached(row)
    roots = search(board, engine, root_nodes, min(3, board.legal_moves.count()))
    candidates = roots["lines"]
    if not candidates:
        return dict(row, status="no-root", candidates=[], replyProbes=[])
    best = candidates[0]["pvUci"][0]
    played = row["playedMoveUci"]
    move = board.parse_uci(best)
    if best == played or board.piece_type_at(move.from_square) != chess.KING or board.is_capture(move):
        return dict(row, status="no-distinct-quiet-king-leader", candidates=candidates, replyProbes=[])
    choices = [move, board.parse_uci(played)]
    paired = search(board, engine, root_nodes, 2, choices)["lines"]
    if len(paired) != 2 or paired[0]["pvUci"][0] != best:
        return dict(row, status="unmatched-pair", candidates=candidates, replyProbes=[])
    child = board.copy()
    child.push(move)
    if not child.legal_moves.count():
        return dict(row, status="terminal", candidates=candidates, replyProbes=[])
    response = search(child, engine, reply_nodes, min(3, child.legal_moves.count()))["lines"]
    return dict(row, status="scored", candidates=candidates, comparisonCandidates=paired,
                replyProbes=[{"moveUci": best, "lines": response}])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="command", required=True)
    select = modes.add_parser("freeze")
    for name in ("lab", "output", "manifest"):
        select.add_argument(name, type=Path)
    analyse = modes.add_parser("score")
    for name in ("input", "engine", "output"):
        analyse.add_argument(name, type=Path)
    analyse.add_argument("--root-nodes", type=int, default=2400000)
    analyse.add_argument("--reply-nodes", type=int, default=1000000)
    args = parser.parse_args()
    if args.command == "freeze":
        rows, manifest = freeze(args.lab)
        with args.manifest.open("x", encoding="utf-8") as out:
            json.dump(manifest, out, indent=2)
    else:
        try:
            with ThreadPoolExecutor(7) as pool:
                rows = list(pool.map(
                    lambda row: score(row, str(args.engine), args.root_nodes, args.reply_nodes),
                    json.loads(args.input.read_bytes()),
                ))
        finally:
            for engine in engines:
                engine.quit()
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(rows, out, separators=(",", ":"))
        out.write("\n")
    print(len(rows), "games from", len({row["event"] for row in rows}), "families",
          sha256(args.output.read_bytes()).hexdigest(), flush=True)


if __name__ == "__main__":
    main()
