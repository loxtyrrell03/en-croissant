"""Select played classical endgames without using any tablebase outcomes."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "strategic-choice-contrast"))
from audit_split import normalized_family
from transfer import board_key, classical_sources, frames


def evaluate_game(game, key, excluded):
    start = game.board()
    board = start.copy()
    history, choices = [], []
    for node in game.mainline():
        move = node.move
        if (
            5 <= len(board.piece_map()) <= 7 and not board.is_game_over(claim_draw=True)
            and not board.is_repetition(2) and 5 <= board.fullmove_number <= 100
            and not board.castling_rights and board.halfmove_clock < 80
            and not board.has_legal_en_passant() and board_key(board) not in excluded
        ):
            previous = node.parent.eval()
            after = node.eval()
            delta = None
            if previous is not None and after is not None:
                delta = previous.pov(board.turn).score(mate_score=5000) - after.pov(board.turn).score(mate_score=5000)
            group = (
                "annotated-loss" if delta is not None and delta >= 100 else
                "rook" if board.rooks and board.pawns else "other"
            )
            seed = sha256(f"exact-decisions-v1:{key}:{board.ply()}".encode()).hexdigest()
            choices.append((
                {"annotated-loss": 0, "rook": 1, "other": 2}[group], seed,
                {
                    "id": f"endgame-{seed[:16]}", "fen": board.fen(), "stratum": group,
                    "playedMoveUci": move.uci(), "game": key,
                    "history": {"fen": start.fen(), "moves": list(history)},
                },
            ))
        history.append(move.uci())
        board.push(move)
    if choices:
        return min(choices)[2]


def select(lab, exclusions):
    archived = [row for file in exclusions for row in json.loads(file.read_bytes())]
    excluded = {board_key(chess.Board(row["fen"])) for row in archived}
    games = {frames.game_key(row) for row in archived
             if row.get("history") and len(row["history"]["moves"]) >= 24}
    pools = defaultdict(list)
    sources = {}
    for path, (event, url) in sorted(classical_sources(lab).items(), key=lambda p: (p[1], p[0].name)):
        family = normalized_family(event)
        if "european-youth" in family:
            continue
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                key = frames.game_key({"history": {
                    "fen": game.board().fen(), "moves": [move.uci() for move in game.mainline_moves()],
                }})
                if key in games:
                    continue
                games.add(key)
                row = evaluate_game(game, key, excluded)
                if row:
                    excluded.add(board_key(chess.Board(row["fen"])))
                    site = game.headers.get("Site", "")
                    pools[(row["stratum"], family)].append(dict(
                        row, event=family, site=site if site.startswith("https://lichess.org/broadcast/") else url,
                        source=path.relative_to(lab).as_posix(),
                    ))
                    sources[path.relative_to(lab).as_posix()] = sha256(path.read_bytes()).hexdigest()
    result = []
    for stratum, limit in (("annotated-loss", 20), ("rook", 16), ("other", 12)):
        groups = [sorted(rows, key=lambda row: row["id"]) for key, rows in sorted(pools.items())
                  if key[0] == stratum]
        staggered = [rows[i] for i in range(max(map(len, groups), default=0))
                     for rows in groups if i < len(rows)]
        result.extend(staggered[:limit])
    return {
        "sample": result,
        "sources": {row["source"]: sources[row["source"]] for row in result},
        "excludedInputs": {file.name: sha256(file.read_bytes()).hexdigest() for file in exclusions},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("exclude", type=Path, nargs="+")
    args = parser.parse_args()
    freeze = select(args.lab, args.exclude)
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(freeze, file, separators=(",", ":"))
        file.write("\n")
    print(Counter(row["stratum"] for row in freeze["sample"]), len({row["event"] for row in freeze["sample"]}))


if __name__ == "__main__":
    main()
