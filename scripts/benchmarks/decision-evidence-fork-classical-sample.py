"""Select exact played fork candidates from classical PGNs before evaluation."""

import argparse
import hashlib
import importlib
import json
from pathlib import Path

import chess
import chess.pgn

payoff = importlib.import_module("decision-evidence-fork-payoff")
corpus = payoff.corpus
tournament = importlib.import_module("decision-evidence-tournament")


def select_games(path, name, blocked_boards, blocked_games, actor=None):
    by_game = {}
    with path.open(encoding="utf-8-sig") as file:
        while game := chess.pgn.read_game(file):
            board = game.board()
            if game.errors or type(board) is not chess.Board or not board.is_valid():
                continue
            moves = list(game.mainline_moves())
            if len(moves) < 28 or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
                continue
            game_key = tournament.digest((tournament.board_key(board.fen()) + " "
                                          + " ".join(move.uci() for move in moves)).encode())
            if game_key in blocked_games:
                continue
            player = None
            if actor:
                matches = [color for color, name in [(chess.WHITE, "White"), (chess.BLACK, "Black")]
                           if actor.casefold() in game.headers.get(name, "").casefold()]
                if len(matches) != 1:
                    continue
                player = matches[0]
            for move in moves:
                ply = board.ply()
                if 26 <= ply <= 155 and (player is None or board.turn == player) and payoff.geometry(board, move):
                    board_key = corpus.board_identity(board)
                    if board_key not in blocked_boards:
                        row = dict(id=f"fork-{name}-{game_key[:16]}-{ply}", game=game_key, split="classical",
                                   event=name, fen=board.fen(), boardKey=board_key, move=move.uci(),
                                   origin="played", ply=ply)
                        by_game.setdefault(game_key, []).append(row)
                board.push(move)
    return by_game


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--puzzles", type=Path, required=True)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    parser.add_argument("--event", nargs=2, action="append", metavar=("NAME", "PGN"), required=True)
    parser.add_argument("--private-pgn", type=Path, action="append", default=[])
    parser.add_argument("--private-player")
    parser.add_argument("--per-event", type=int, default=24)
    args = parser.parse_args()
    if bool(args.private_pgn) != bool(args.private_player):
        raise ValueError("Private PGNs require the matching player")
    training = [payoff.read(args.puzzles / f"{key}.json")["identity"]
                for key in payoff.read(args.puzzles / "receipt.json")["ids"]]
    blocked_boards = {row["boardKey"] for row in training}
    blocked_games = {row["game"] for row in training}
    for path in args.exclude:
        for row in payoff.read(path)["cases"]:
            blocked_boards.add(corpus.board_identity(chess.Board(row["fen"])))
            group = row.get("sourceGroup") or row.get("game")
            if group:
                blocked_games.add(group.removeprefix("game:"))
    choices, sources = [], {}

    def append(pool, limit):
        for game_key in sorted(pool, key=payoff.key):
            if limit <= 0:
                break
            candidates = [row for row in pool[game_key] if row["boardKey"] not in blocked_boards]
            if game_key in blocked_games or not candidates:
                continue
            row = min(candidates, key=lambda candidate: payoff.key(candidate["id"]))
            choices.append(row)
            blocked_games.add(game_key)
            blocked_boards.add(row["boardKey"])
            limit -= 1

    for name, path in args.event:
        path = Path(path)
        pool = select_games(path, name, blocked_boards, blocked_games)
        sources[name] = dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), eligibleGames=len(pool))
        append(pool, args.per_event)
    own = {}
    for path in args.private_pgn:
        own.update(select_games(path, "private", blocked_boards, blocked_games, args.private_player))
    append(own, args.per_event)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(dict(sources=sources, cases=choices), file, indent=2)


if __name__ == "__main__":
    main()
