"""Retrieve public games with two ways to capture on the same square near the king."""

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


def stratum(board, move):
    king = board.king(board.turn)
    if king is None or not board.is_capture(move):
        return None
    file_mask = chess.BB_FILES[chess.square_file(king)]
    shield = board.pieces(chess.PAWN, board.turn) & file_mask
    if not shield:
        return None
    captures = list(board.generate_legal_captures(to_mask=chess.BB_SQUARES[move.to_square]))
    takes_with_shield = [capture for capture in captures if capture.from_square in shield]
    other_pieces = [
        capture for capture in captures if board.piece_type_at(capture.from_square) != chess.PAWN
    ]
    if takes_with_shield and other_pieces:
        if move in takes_with_shield:
            return "pawn-chooses-capture"
        if move in other_pieces:
            return "piece-chooses-capture"
    return None


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
                cases = []
                overlap = False
                for move in moves:
                    fen = board.fen()
                    overlap |= tournament.board_key(fen) in boards
                    ply = board.ply()
                    choice = stratum(board, move) if 24 <= ply <= 99 else None
                    if choice:
                        cases.append(dict(
                            id=f"shelter-{event}-{group[:16]}-{ply}", event=event, stratum=choice,
                            fen=fen, ply=ply, playedMoveUci=move.uci(), sourceGroup=group,
                            split="validation", category="public-classical-broadcast",
                        ))
                    board.push(move)
                if cases and not overlap:
                    pool[group] = sorted(cases, key=lambda row: tournament.order(row["id"]))
    selected = []
    for choice in ["pawn-chooses-capture", "piece-chooses-capture"]:
        for group in sorted(pool, key=tournament.order):
            if group in groups:
                continue
            match = next((row for row in pool[group] if row["stratum"] == choice), None)
            if match is None:
                continue
            selected.append(match)
            groups.add(group)
            if sum(row["stratum"] == choice for row in selected) == 6:
                break
        if sum(row["stratum"] == choice for row in selected) != 6:
            raise ValueError(f"Need six separate games in {choice}")
    manifest = dict(
        protocol=1, cases=selected, events=events, exclusions=exclusions,
        scope="Both a king-file pawn and a different piece can capture the same target. "
              "Recorded pawn or piece captures are retrieval strata, not reference labels.",
    )
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
    print(f"Selected {len(selected)} positions from separate games")


if __name__ == "__main__":
    main()
