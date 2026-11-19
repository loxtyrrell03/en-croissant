"""Select independent games with advanced passers retained or resolved in play."""

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


def advanced_passed_pawn(board, square, side):
    rank = chess.square_rank(square)
    column = chess.square_file(square)
    return (
        5 <= (rank if side else 7 - rank) <= 6
        and not any(
            abs(chess.square_file(pawn) - column) <= 1
            and (chess.square_rank(pawn) - rank) * (1 if side else -1) > 0
            for pawn in board.pieces(chess.PAWN, not side)
        )
    )


def pawn_trajectory(board, moves):
    if len(moves) != 6 or not all(board.pieces(chess.ROOK, colour) for colour in chess.COLORS):
        return None
    persisting = False
    for side in chess.COLORS:
        for start in board.pieces(chess.PAWN, side):
            if not advanced_passed_pawn(board, start, side):
                continue
            future, square = board.copy(stack=False), start
            for ply, move in enumerate(moves, 1):
                if future.turn == side and move.from_square == square:
                    square = move.to_square
                future.push(move)
                if future.piece_at(square) != chess.Piece(chess.PAWN, side):
                    if ply <= 4:
                        return "resolved-early"
                    break
            else:
                persisting = True
    return "persisted" if persisting else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("excluded", nargs="+", type=Path)
    parser.add_argument("--event", action="append", required=True, nargs=2)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("Use a new sample outside the checkout")
    excluded_boards, excluded_groups, pool, events = set(), set(), {}, {}
    exclusion_hashes = []
    for sample in args.excluded:
        raw = sample.read_bytes()
        exclusion_hashes.append(tournament.digest(raw))
        for row in json.loads(raw)["cases"]:
            excluded_boards.add(tournament.board_key(row["fen"]))
            if row.get("sourceGroup"):
                excluded_groups.add(row["sourceGroup"])
    for event, source in args.event:
        path = Path(source)
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
                if group in excluded_groups:
                    continue
                cases, overlaps = [], False
                for i, move in enumerate(moves):
                    fen = board.fen()
                    overlaps |= tournament.board_key(fen) in excluded_boards
                    stratum = pawn_trajectory(board, moves[i:i + 6]) if i >= 28 else None
                    if stratum and board.legal_moves.count() >= 3:
                        cases.append(dict(
                            id=f"passer-{event}-{group[:16]}-{i}", event=event, stratum=stratum,
                            fen=fen, ply=board.ply(), playedMoveUci=move.uci(), sourceGroup=group,
                            split="validation", category="public-classical-broadcast",
                        ))
                    board.push(move)
                if cases and not overlaps:
                    pool[group] = sorted(cases, key=lambda row: tournament.order(row["id"]))
    chosen = []
    for stratum in ("resolved-early", "persisted"):
        matches = []
        for group in sorted(pool, key=tournament.order):
            if group in excluded_groups:
                continue
            row = next((item for item in pool[group] if item["stratum"] == stratum
                        and tournament.board_key(item["fen"]) not in excluded_boards), None)
            if row:
                matches.append(row)
                excluded_groups.add(group)
                excluded_boards.add(tournament.board_key(row["fen"]))
            if len(matches) == 6:
                break
        if len(matches) != 6:
            raise ValueError(f"Need six distinct games in {stratum}, found {len(matches)}")
        chosen.extend(matches)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(
            protocol=1, cases=chosen, events=events, exclusions=exclusion_hashes,
            scope="Both sides retain a rook and at least one pawn is an advanced passer. "
                  "Recorded persistence or resolution selects the sample; it does not supply the label.",
        ), stream, indent=2)
    print(f"Selected {len(chosen)} boards from separate games")


if __name__ == "__main__":
    main()
