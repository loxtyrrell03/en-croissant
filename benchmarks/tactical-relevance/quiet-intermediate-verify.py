"""Independent python-chess finite verification of the selected quiet-order paths.

Strategies contain attacker choices, not legal-reply lists or supplied FENs.
Each root defence, reached balance, nonchecking leaf, legal exchange and immediate
countercheck is reconstructed. The finite leaf checker is shared with the prior
independent clearance audit, not production TypeScript. This is not full WDL or
absence of longer quiet counterplay/repetition. No engine/private data is read.
"""
import importlib.util
import argparse
import json
from pathlib import Path
import chess

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("local_material", HERE / "quiet-clearance-verify.py")
MATERIAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATERIAL)


def verify():
    sources = json.loads((HERE / "quiet-intermediate-strategy.json").read_text())
    cases = []
    for source in sources:
        for reflected in [False, True]:
            initial = chess.Board(source["fen"])
            if reflected:
                initial = initial.mirror()
            assert initial.is_valid()
            flip = lambda square: chess.square_mirror(square) if reflected else square
            move = lambda uci: chess.Move(flip(chess.parse_square(uci[:2])), flip(chess.parse_square(uci[2:4])))

            def certificate(before, root_uci, strategy):
                counts = {"rootReplies": 0, "leaves": 0, "counterchecks": 0}
                root = move(root_uci)
                after_root = MATERIAL.after(before, root)
                # chessops records orthodox castling king-to-rook; normalize
                # through the reached board's legal parser, not string edits.
                replies = [after_root.parse_uci(move(path["moves"][0]).uci()).uci() for path in strategy["paths"]]
                assert len(replies) == len(set(replies))
                assert set(replies) == {action.uci() for action in after_root.legal_moves}
                counts["rootReplies"] = len(replies)
                gains = []
                for path in strategy["paths"]:
                    board = after_root.copy()
                    balance = MATERIAL.delta(before, root)
                    for uci in path["moves"][:-1]:
                        action = board.parse_uci(move(uci).uci())
                        balance += (1 if board.turn == before.turn else -1) * MATERIAL.delta(board, action)
                        board = MATERIAL.after(board, action)
                    assert board.turn == before.turn
                    final = board.parse_uci(move(path["moves"][-1]).uci())
                    gain = balance + MATERIAL.retained(board, final, counts)
                    assert gain >= path["bound"], (board.fen(), final.uci(), gain, path["bound"])
                    counts["leaves"] += 1
                    gains.append(gain)
                minimum = min(gains)
                assert minimum >= strategy["bound"]
                return {"independentLocalMinimum": minimum, "productionLowerBound": strategy["bound"], **counts}

            forward = certificate(initial, source["root"], source["forward"])
            deferred, reverse_move = source["reverse"]["prefix"]
            reversed_board = MATERIAL.after(initial, move(deferred))
            reverse = certificate(reversed_board, reverse_move, source["reverse"])
            assert forward["independentLocalMinimum"] >= 230
            assert reverse["independentLocalMinimum"] >= 330
            deferred_capture = MATERIAL.delta(initial, move(deferred))
            reverse_upper = deferred_capture - reverse["independentLocalMinimum"]
            cases.append({"kind": source["kind"], "reflected": reflected,
                          "forward": forward, "recovery": reverse,
                          "reversedOrderUpper": reverse_upper,
                          "orderImprovementLower": forward["independentLocalMinimum"] - reverse_upper})
    return {"scope": "Independent finite legal/material frontier audit, not game-theoretic WDL", "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Optional new, never-overwritten JSON receipt")
    args = parser.parse_args()
    result = json.dumps(verify(), indent=2)
    if args.report:
        with args.report.open("x", encoding="utf-8") as report:
            report.write(result + "\n")
    print(result)
