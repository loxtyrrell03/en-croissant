"""Check newly reported routes with an independent legal board replay."""

import argparse
from collections import Counter
from pathlib import Path

import chess

from score import indexed, root_motifs


PIECE_VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
                chess.ROOK: 500, chess.QUEEN: 900}


def material(board, color):
    return sum(value * (len(board.pieces(role, color)) - len(board.pieces(role, not color)))
               for role, value in PIECE_VALUES.items())


def check(witness):
    root = chess.Board(witness["fen"])
    boards = [root.copy()]
    moves = []
    for uci in witness["lineUci"]:
        move = boards[-1].parse_uci(uci)
        board = boards[-1].copy(stack=False)
        board.push(move)
        moves.append(move)
        boards.append(board)
    payoff = witness["payoffPly"]
    if not boards[payoff].is_checkmate():
        opening = material(root, root.turn)
        previous = material(boards[payoff - 1], root.turn)
        assert material(boards[-1], root.turn) >= max(opening, previous) + 100

    squares = list(map(chess.parse_square, witness["squares"]))
    if witness["mechanism"] == "clearance":
        vacancy, source, destination = squares[:3]
        assert moves[0].from_square == vacancy
        crossing = chess.Move(source, destination)
        index = moves.index(crossing, 2)
        prior = boards[index].copy(stack=False)
        assert prior.piece_at(vacancy) is None
        prior.set_piece_at(vacancy, root.piece_at(vacancy))
        assert not prior.is_legal(crossing)
        return

    guard, displaced, source, destination = squares
    assert moves[1].from_square == guard and moves[1].to_square == displaced
    followup = chess.Move(source, destination)
    assert followup in moves[2:]
    prior = root.copy(stack=False)
    if not prior.is_legal(followup):
        assert chess.between(source, destination) & chess.BB_SQUARES[guard]
        prior.remove_piece_at(guard)
        assert prior.is_legal(followup)
    else:
        prior.push(followup)
        assert prior.is_legal(chess.Move(guard, destination))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    baseline = indexed(args.baseline)
    candidate = indexed(args.candidate)
    assert baseline.keys() == candidate.keys()
    verified = Counter()
    for key, row in candidate.items():
        if not row["report"]:
            continue
        for before, after in zip(baseline[key]["report"]["moves"], row["report"]["moves"], strict=True):
            new = root_motifs(after) - root_motifs(before)
            for witness in after["mechanisms"]:
                if witness["mechanism"] in new & {"deflection", "clearance"}:
                    try:
                        check(witness)
                    except (ValueError, AssertionError) as error:
                        raise AssertionError(f"{key} failed the independent route check") from error
                    verified[witness["mechanism"]] += 1
    print(dict(verified))


if __name__ == "__main__":
    main()
