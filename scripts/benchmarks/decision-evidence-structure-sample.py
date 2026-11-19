"""Sample played moves around pawn contact and open-file rook exchanges.

The recorded next moves select positions with observable structural
interactions. They do not assign the tactical or positional reference.
"""

import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn


SPEC = importlib.util.spec_from_file_location(
    "tournament", Path(__file__).with_name("decision-evidence-tournament.py"),
)
tournament = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tournament)
STRATA = ("open-file-rook-trade", "central-contact-exchanged", "central-contact-held")


def pawn_contact(board, moves):
    start = moves[0]
    side = board.turn
    if (board.piece_type_at(start.from_square) != chess.PAWN or board.is_capture(start)
            or start.promotion or not 2 <= chess.square_file(start.to_square) <= 5):
        return None
    future = board.copy(stack=False)
    future.push(start)
    targets = future.attacks(start.to_square) & future.pieces(chess.PAWN, not side)
    for target in targets:
        line = future.copy(stack=False)
        for reply in moves[1:5]:
            capture = line.is_capture(reply) and (
                (line.turn == side and reply.from_square == start.to_square and reply.to_square == target)
                or (line.turn != side and reply.from_square == target and reply.to_square == start.to_square)
            )
            if capture:
                return "central-contact-exchanged"
            line.push(reply)
            if line.piece_at(start.to_square) != chess.Piece(chess.PAWN, side) or line.piece_at(target) != chess.Piece(chess.PAWN, not side):
                break
        else:
            return "central-contact-held"
    return None


def open_file_trade(board, moves):
    start = moves[0]
    column = chess.square_file(start.to_square)
    if board.piece_type_at(start.from_square) != chess.ROOK or any(
        chess.square_file(square) == column for square in board.pieces(chess.PAWN, True) | board.pieces(chess.PAWN, False)
    ):
        return None
    future = board.copy(stack=False)
    for move, after in zip(moves[:4], moves[1:5]):
        rook_trade = (
            chess.square_file(move.from_square) == column == chess.square_file(move.to_square)
            and future.piece_type_at(move.from_square) == future.piece_type_at(move.to_square) == chess.ROOK
            and future.is_capture(move)
            and after.to_square == move.to_square
        )
        future.push(move)
        if rook_trade and future.is_capture(after):
            return "open-file-rook-trade"
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--event", nargs=2, action="append", required=True, metavar=("EVENT", "PGN"))
    parser.add_argument("--exclude-sample", type=Path, action="append", default=[])
    parser.add_argument("--per-stratum", type=int, default=6)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new sample outside the checkout")
    if args.per_stratum < 1:
        raise ValueError("The sample limit must be positive")
    boards, groups, exclusions = set(), set(), []
    for sample in args.exclude_sample:
        raw = sample.read_bytes()
        exclusions.append(tournament.digest(raw))
        for case in json.loads(raw)["cases"]:
            boards.add(tournament.board_key(case["fen"]))
            if case.get("sourceGroup"):
                groups.add(case["sourceGroup"])
    pool, events = {}, {}
    for event, source in args.event:
        if event in events:
            raise ValueError("Provide distinct source names")
        path = Path(source)
        events[event] = tournament.digest(path.read_bytes())
        with path.open(encoding="utf-8-sig") as stream:
            while game := chess.pgn.read_game(stream):
                board = game.board()
                if (game.errors or type(board) is not chess.Board or not board.is_valid()
                        or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2")):
                    continue
                moves = list(game.mainline_moves())
                group = tournament.digest(
                    (tournament.board_key(board.fen()) + " " + " ".join(move.uci() for move in moves)).encode(),
                )
                if group in groups or group in pool:
                    continue
                candidates = []
                for i, move in enumerate(moves):
                    ply, fen = board.ply(), board.fen()
                    if 26 <= ply <= 119 and i + 5 <= len(moves) and board.legal_moves.count() >= 5 and tournament.board_key(fen) not in boards:
                        line = moves[i:i + 5]
                        stratum = pawn_contact(board, line) or open_file_trade(board, line)
                        if stratum:
                            candidates.append(dict(id=f"structure-{event}-{group[:16]}-{ply}", fen=fen,
                                                   playedMoveUci=move.uci(), sourceGroup=group, event=event,
                                                   ply=ply, stratum=stratum, split="validation",
                                                   category="public-classical-broadcast"))
                    board.push(move)
                if candidates:
                    pool[group] = candidates
    rows, counts = [], {}
    for stratum in STRATA:
        count = 0
        for group in sorted(pool, key=tournament.order):
            if group in groups:
                continue
            available = [case for case in pool[group] if case["stratum"] == stratum
                         and tournament.board_key(case["fen"]) not in boards]
            if not available:
                continue
            chosen = min(available, key=lambda case: tournament.order(case["id"]))
            rows.append(chosen)
            boards.add(tournament.board_key(chosen["fen"]))
            groups.add(group)
            count += 1
            if count == args.per_stratum:
                break
        if count != args.per_stratum:
            raise ValueError(f"Need {args.per_stratum} distinct games in {stratum}, found {count}")
        counts[stratum] = count
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(protocol=1, cases=rows, events=events, exclusions=exclusions, strata=counts,
                       scope="One classical position per game selected by recorded structural interactions."), stream, indent=2)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
