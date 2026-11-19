"""Prepare independently replayed mate-in-one reference labels."""
import argparse
import json
from pathlib import Path

import chess
from scan import mates


def exhaustive_reference(board, lines):
    if board.is_check():
        return {"target": False, "reason": "in-check"}
    if not lines or lines[0]["cp"] is None or lines[0]["depth"] < 16:
        return {"target": False, "reason": "no-finite-leading-evaluation"}
    if board.halfmove_clock >= 99:
        return {"target": False, "reason": "draw-boundary"}
    defence = chess.Move.from_uci(lines[0]["pvUci"][0])
    if defence not in board.legal_moves or board.gives_check(defence):
        return {"target": False, "reason": "checking-or-illegal-leader"}
    without_action = board.copy(stack=False)
    without_action.push(chess.Move.null())
    pending = set(mates(without_action))
    if not pending:
        return {"target": False, "reason": "no-existing-mate"}
    reached = board.copy(stack=False)
    reached.push(defence)
    if reached.is_game_over() or mates(reached):
        return {"target": False, "reason": "defence-allows-mate-or-ends-game"}
    searched = {line["pvUci"][0] for line in lines[1:]}
    witnesses = []
    for move in board.legal_moves:
        if move == defence:
            continue
        child = board.copy(stack=False)
        child.push(move)
        if child.is_check() or child.is_game_over():
            continue
        matching = sorted(pending.intersection(mates(child)))
        if matching:
            witnesses.append({
                "move": move.uci(),
                "mates": matching,
                "searched": move.uci() in searched,
                "quietNonKing": not (
                    board.is_capture(move) or move.promotion or
                    board.piece_type_at(move.from_square) == chess.KING),
            })
    return {
        "target": any(item["searched"] or item["quietNonKing"] for item in witnesses),
        "reason": "checked-all-legal-branches",
        "defence": defence.uci(),
        "witnesses": witnesses,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    source = json.loads((args.work / "engine.json").read_bytes())
    rows = []
    for row in source:
        selected = {field: row[field] for field in (
            "id", "fen", "sourceGroup", "event", "stratum", "playedMoveUci",
            "candidates", "replyProbes",
        )}
        selected["reference"] = exhaustive_reference(chess.Board(row["fen"]), row["candidates"])
        rows.append(selected)
    with (args.work / "input.json").open("x", encoding="utf-8", newline="\n") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
