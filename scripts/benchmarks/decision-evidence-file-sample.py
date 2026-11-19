"""Select fresh classical positions with similar rook entries and different follow-ups."""
import argparse
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn

spec = importlib.util.spec_from_file_location(
    "tournament", Path(__file__).with_name("decision-evidence-tournament.py"),
)
tournament = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tournament)


def follow_up(board, first_move, following):
    side = board.turn
    tracked = first_move.to_square
    column = chess.square_file(tracked)
    if (
        board.piece_type_at(first_move.from_square) != chess.ROOK
        or chess.square_file(first_move.from_square) == column
        or board.is_capture(first_move)
        or board.is_check()
        or board.gives_check(first_move)
        or (chess.square_rank(tracked) if side else 7 - chess.square_rank(tracked)) >= 4
        or board.pieces(chess.PAWN, side) & chess.BB_FILES[column]
    ):
        return None
    board = board.copy(stack=False)
    board.push(first_move)
    for offset, move in enumerate(following[:11]):
        if board.pieces(chess.PAWN, side) & chess.BB_FILES[column]:
            break
        own_move = board.turn == side and move.from_square == tracked
        takes_rook = board.turn != side and move.to_square == tracked
        if not own_move and not takes_rook:
            board.push(move)
            continue
        if {chess.square_file(move.from_square), chess.square_file(move.to_square)} != {column}:
            break
        if board.is_capture(move):
            piece_pair = board.piece_type_at(move.from_square) == board.piece_type_at(move.to_square) == chess.ROOK
            reply = following[offset + 1]
            if offset > 0 and piece_pair and reply.to_square == move.to_square and not reply.promotion:
                return "later-equal-exchange"
            break
        tracked = move.to_square
        if (chess.square_rank(tracked) if side else 7 - chess.square_rank(tracked)) >= 4:
            return None
        board.push(move)
    return "file-entry-without-use"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("excluded", nargs="+", type=Path)
    parser.add_argument("--event", action="append", required=True, nargs=2)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new sample file outside the checkout")
    exclusions = []
    boards, groups = set(), set()
    for path in args.excluded:
        raw = path.read_bytes()
        exclusions.append(tournament.digest(raw))
        for row in json.loads(raw)["cases"]:
            boards.add(tournament.board_key(row["fen"]))
            if row.get("sourceGroup"):
                groups.add(row["sourceGroup"])
    pool = {}
    events = {}
    for event, path in args.event:
        path = Path(path)
        events[event] = tournament.digest(path.read_bytes())
        with path.open(encoding="utf-8-sig") as stream:
            while game := chess.pgn.read_game(stream):
                board = game.board()
                moves = list(game.mainline_moves())
                if game.errors or type(board) is not chess.Board or not board.is_valid():
                    continue
                group = tournament.digest(
                    (tournament.board_key(board.fen()) + " " + " ".join(move.uci() for move in moves)).encode(),
                )
                if group in groups:
                    continue
                game_cases = []
                overlap = False
                for i, move in enumerate(moves):
                    fen = board.fen()
                    overlap |= tournament.board_key(fen) in boards
                    ply = board.ply()
                    if 24 <= ply <= 99 and len(moves) >= i + 13:
                        use = follow_up(board, move, moves[i + 1:i + 13])
                        if use:
                            game_cases.append(dict(
                                id=f"file-{event}-{group[:16]}-{ply}", event=event, stratum=use,
                                fen=fen, ply=ply, playedMoveUci=move.uci(), sourceGroup=group,
                                split="validation", category="public-classical-broadcast",
                            ))
                    board.push(move)
                if game_cases and not overlap:
                    pool[group] = sorted(game_cases, key=lambda row: tournament.order(row["id"]))
    selected = []
    for stratum in ["later-equal-exchange", "file-entry-without-use"]:
        ids = [group for group in sorted(pool, key=tournament.order)
               if group not in groups and any(row["stratum"] == stratum for row in pool[group])]
        if len(ids) < 6:
            raise ValueError(f"Only {len(ids)} separate games in {stratum}")
        for group in ids[:6]:
            selected.append(next(row for row in pool[group] if row["stratum"] == stratum))
            groups.add(group)
    manifest = dict(protocol=1, cases=selected, events=events, exclusions=exclusions,
                    scope="Recorded quiet rook entry below the fifth rank, six balanced-exchange retrievals and six controls. Strata are not reference labels.")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
    print(f"Selected {len(selected)} positions from separate games")


if __name__ == "__main__":
    main()
