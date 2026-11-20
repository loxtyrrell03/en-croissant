"""Freeze bounded classical positions with an existing advanced passer."""
import argparse
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "reply-search-allocation"))
# This file is executed as a script or imported under a different module name.
from sample import board_key, classical_sources
sys.path.insert(0, str(HERE.parent / "neural-passer-probe"))
from assets import passed, relative_rank
sys.path.insert(0, str(HERE.parent / "neural-deep-witness"))
from frames import family, game_key


PROTOCOL = json.loads((HERE / "protocol.json").read_text(encoding="utf-8"))


def stable_key(*fields):
    return sha256(":".join((PROTOCOL["seed"], *map(str, fields))).encode()).hexdigest()


def eligible_move(board, move, pawn):
    victim = move.to_square - (8 if board.turn else -8) if board.is_en_passant(move) else move.to_square
    return move.from_square != pawn and victim != pawn


def choose(game, event, site):
    board = game.board()
    moves = list(game.mainline_moves())
    if len(moves) < 42:
        return None
    signature = game_key({"history": {"fen": board.fen(), "moves": [move.uci() for move in moves]}})
    ranked = []
    for ply, move in enumerate(moves[:-4]):
        if ply >= 30 and len(board.piece_map()) <= PROTOCOL["sample"]["maxPieces"]:
            for color in (not board.turn, board.turn):
                for square in board.pieces(chess.PAWN, color):
                    rank = relative_rank(square, color) + 1
                    if rank not in PROTOCOL["sample"]["ranks"] or not passed(board, square, color):
                        continue
                    if not eligible_move(board, move, square):
                        continue
                    if sum(eligible_move(board, alternative, square)
                           for alternative in board.generate_legal_moves()) < 2:
                        continue
                    if board.is_game_over(claim_draw=True):
                        continue
                    front = square + (8 if color else -8)
                    pressure = board.is_attacked_by(not color, front) or board.is_attacked_by(not color, square)
                    seed = stable_key(signature, ply, square)
                    ranked.append(((rank != 6, not pressure, seed), ply, square, color, board.fen(), move.uci()))
        board.push(move)
    if not ranked:
        return None
    _, ply, pawn, color, fen, uci = min(ranked)
    tagged = game.headers.get("Site", "")
    return {
        "id": f"passer-pair-{stable_key(signature, ply, pawn)[:16]}",
        "game": signature, "event": family(event),
        "site": tagged if tagged.startswith("https://lichess.org/broadcast/") else site,
        "fen": fen, "played": uci, "pawn": chess.square_name(pawn),
        "opponentPawn": chess.Board(fen).turn != color,
        "history": {"fen": game.board().fen(), "moves": [move.uci() for move in moves[:ply]]},
    }


def sample(lab, exclusions):
    sources = classical_sources(lab)
    old_games = {row["game"] for file in exclusions
                 for line in file.read_text(encoding="utf-8").splitlines()
                 if (row := json.loads(line)).get("game")}
    games, seen_boards = set(), set()
    pools = defaultdict(list)
    for file, (event, site) in sorted(sources.items(), key=lambda row: (row[1], row[0].name)):
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                row = choose(game, event, site)
                if row is None or row["game"] in games or row["game"] in old_games:
                    continue
                identity = board_key(chess.Board(row["fen"]))
                if identity in seen_boards:
                    continue
                games.add(row["game"])
                seen_boards.add(identity)
                # Both strata receive an independent turn in the round-robin sampler.
                pools[(row["event"], row["opponentPawn"])].append(row)
    for rows in pools.values():
        rows.sort(key=lambda row: row["id"])
    cohorts = {}
    for split, holdout in (("development", False), ("transfer", True)):
        names = sorted(
            {event for event, _ in pools if (int(stable_key(event)[:2], 16) % 3 == 0) == holdout},
            key=stable_key,
        )
        quotas = PROTOCOL["sample"][split]
        cohort = cohorts[split] = []
        goal_opponent = round(quotas * PROTOCOL["sample"]["targetOpponentShare"])
        for opponent, limit in ((True, goal_opponent), (False, quotas - goal_opponent)):
            offset, count = 0, 0
            while count < limit:
                added = 0
                for event in names:
                    rows = pools.get((event, opponent), [])
                    if offset < len(rows):
                        cohort.append(rows[offset])
                        added += 1
                        count += 1
                        if count == limit:
                            break
                if not added:
                    raise ValueError(f"Could not satisfy the {split} owner-side quota")
                offset += 1
    return cohorts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("exclusions", nargs="*", type=Path)
    args = parser.parse_args()
    cohorts = sample(args.lab, args.exclusions)
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(cohorts, out, separators=(",", ":"))
        out.write("\n")
    print({name: (len(rows), len({row["event"] for row in rows})) for name, rows in cohorts.items()})


if __name__ == "__main__":
    main()
