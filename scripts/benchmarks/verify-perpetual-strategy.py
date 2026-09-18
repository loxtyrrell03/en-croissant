"""Independently verify complete legal checking strategies and path-local cycles.

The input contains cases with fen, root and an opt-in proof.strategy tree.
Engine scores and example PVs are deliberately not used as proof. This checks
an available repeatable strategy, not a draw already claimed or a forced win.
"""
import argparse
import copy
import json
from pathlib import Path

import chess


def legal_move(board, uci):
    matches = [move for move in board.legal_moves
               if uci in (board.uci(move), board.uci(move, chess960=True))]
    assert len(matches) == 1, f"Illegal or ambiguous move {uci}"
    return matches[0]


def verify(case):
    board = chess.Board(case["fen"])
    assert board.is_valid()
    root = legal_move(board, case["root"])
    board.push(root)
    decisions, counts = [], {"edges": 0, "cycles": 0, "mates": 0}

    def walk(position, node, path, depth):
        assert depth <= 5 and position.is_check()
        assert position.fen() == node["fen"], "Position identity mismatch"
        key = " ".join(position.fen().split()[:4])
        if "terminal" in node:
            assert "replies" not in node
            if node["terminal"] == "cycle":
                assert key in path, "Cycle must close on this exact branch"
                counts["cycles"] += 1
            else:
                assert node["terminal"] == "mate" and position.is_checkmate()
                counts["mates"] += 1
            return
        assert key not in path and not position.is_game_over(claim_draw=False)
        replies = node["replies"]
        represented = [legal_move(position, item["replyUci"]) for item in replies]
        assert len(set(represented)) == len(represented)
        assert set(represented) == set(position.legal_moves), "Incomplete defence coverage"
        for reply, branch in zip(represented, replies):
            next_board = position.copy(stack=False)
            next_board.push(reply)
            move = legal_move(next_board, branch["checkUci"])
            decisions.append({"fen": next_board.fen(), "searchMove": next_board.uci(move)})
            next_board.push(move)
            counts["edges"] += 1
            walk(next_board, branch["next"], path + [key], depth + 1)

    walk(board, case["proof"]["strategy"], [], 0)
    assert counts["cycles"] > 0
    assert case["proof"]["replyCount"] == board.legal_moves.count()
    return {"id": case["id"], **counts, "decisions": decisions}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    assert not args.output.resolve().is_relative_to(repo), "Keep private results outside the checkout"
    data = json.loads(args.input.read_text(encoding="utf-8"))
    results = [verify(case) for case in data["cases"]]
    rejected = []
    for case in data["cases"]:
        for mutation in ("missing-defence", "false-cycle", "wrong-position"):
            bad = copy.deepcopy(case)
            node = bad["proof"]["strategy"]
            if mutation == "missing-defence":
                node["replies"].pop()
            elif mutation == "false-cycle":
                bad["proof"]["strategy"] = {"fen": node["fen"], "terminal": "cycle"}
            else:
                node["fen"] = bad["fen"]
            try:
                verify(bad)
            except AssertionError:
                rejected.append({"id": case["id"], "mutation": mutation})
            else:
                raise AssertionError(f"Accepted invalid {mutation} witness")
    with args.output.open("x", encoding="utf-8") as output:
        json.dump({"scope": "Independent legal branch and cycle verification, not native execution or an accuracy estimate.",
                   "results": results, "rejected": rejected}, output, indent=2)
    print(json.dumps({"cases": len(results), "edges": sum(r["edges"] for r in results),
                      "cycles": sum(r["cycles"] for r in results), "rejected": len(rejected)}))


if __name__ == "__main__":
    main()
