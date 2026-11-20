"""Verify every published conditional mate independently with python-chess."""

import argparse
from collections import Counter
from pathlib import Path

import chess
from sample import checks, mates_one, proof, read


def initial(row):
    if not row.get("history"):
        return chess.Board(row["fen"])
    board = chess.Board(row["history"]["fen"])
    for uci in row["history"]["moves"]:
        board.push_uci(uci)
    assert board.fen() == chess.Board(row["fen"]).fen(), row["id"]
    return board


def any_mate_in_two(board):
    if next(mates_one(board), None):
        return True
    for first in list(board.legal_moves):
        board.push(first)
        if board.is_game_over(claim_draw=True):
            board.pop()
            continue
        replies = list(board.legal_moves)
        won = True
        for answer in replies:
            board.push(answer)
            reply = next(mates_one(board), None)
            board.pop()
            if reply is None:
                won = False
                break
        board.pop()
        if replies and won:
            return True
    return False


def verify(row, proof_record):
    context = initial(row)
    before = context.copy()
    attack_line = proof_record["ignoredLineUci"]
    root, ignored, attack, evasion, mate = attack_line
    assert proof_record["mateIn"] == 2 and not before.is_check(), row["id"]
    quiet = before.parse_uci(root)
    assert not any_mate_in_two(before), ("existing mate", row["id"])
    assert not before.is_capture(quiet) and not quiet.promotion and not before.gives_check(quiet), row["id"]
    before.push(quiet)
    assert not before.can_claim_draw(), row["id"]

    trial = before.copy(stack=False)
    trial.turn = context.turn
    trial.ep_square = None
    assert proof(trial, chess.Move.from_uci(attack)), row["id"]
    assert not next(mates_one(trial), None), row["id"]

    accurate = before.copy()
    accurate.push_uci(ignored)
    assert proof(accurate, chess.Move.from_uci(attack)), row["id"]
    san = context.variation_san(map(chess.Move.from_uci, attack_line))
    for uci in (attack, evasion, mate):
        accurate.push_uci(uci)
    assert accurate.is_checkmate(), row["id"]

    defences = []
    for first, response in proof_record["defenceLinesUci"]:
        assert first == root, row["id"]
        defences.append(context.variation_san(map(chess.Move.from_uci, (first, response))))
        restored = before.copy()
        restored.push_uci(response)
        assert not checks(restored) and not next(mates_one(restored), None), ("defence", row["id"], response)
        assert not any_mate_in_two(restored), ("other mate", row["id"], response)
    return dict(ignored=san, defences=defences)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("worker", type=Path)
    args = parser.parse_args()
    items = {item["id"]: item for item in read(args.input)}
    totals = Counter()
    for row in read(args.worker):
        report = row["report"] or {}
        for move in report.get("moves", []):
            threat = (move.get("quietMateThreat") or {})
            if threat.get("mateIn") == 2:
                result = verify(items[row["id"]], threat)
                print(row["id"], move["moveUci"], result)
                totals["verified"] += 1
    print(dict(totals))


if __name__ == "__main__":
    main()
