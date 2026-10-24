"""Independent finite legal/material replay, not verification of kernel strategy bounds.

Uses an existing python-chess installation. No engine, provider, network or data scan.
Writes a new receipt only; existing receipts cannot be overwritten.
"""
import argparse
import hashlib
import json
from pathlib import Path

import chess

VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}
COUNTS = {"validPositions": 0, "legalPlies": 0, "replayedSelectedLeaves": 0,
          "completeRootReplySets": 0, "rearCaptureRefutations": 0,
          "guardContrasts": 0, "positiveSkewerWitnesses": 0}


def board(fen):
    result = chess.Board(fen)
    assert result.is_valid(), fen
    COUNTS["validPositions"] += 1
    return result


def move(position, uci):
    parsed = chess.Move.from_uci(uci)
    assert parsed in position.legal_moves, (position.fen(), uci)
    result = position.copy(stack=False)
    result.push(parsed)
    COUNTS["legalPlies"] += 1
    return result


def material(position, color):
    return sum(VALUES[piece.piece_type] * (1 if piece.color == color else -1)
               for piece in position.piece_map().values())


def flip(value, reflected):
    return "".join(str(9 - int(char)) if char in "12345678" else char
                   for char in value) if reflected else value


def leaf_replay(before, root_uci, proof):
    # A null bounded search is not a proof of no tactic and receives no credit.
    if proof["gain"] is None:
        return
    after = move(before, root_uci)
    legal = {candidate.uci() for candidate in after.legal_moves}
    leaves = proof["leaves"]
    assert {leaf["lineUci"][0] for leaf in leaves} == legal
    COUNTS["completeRootReplySets"] += 1
    for leaf in leaves:
        assert leaf["lineUci"][-1] == leaf["moveUci"]
        current = after
        for uci in leaf["lineUci"][:-1]:
            current = move(current, uci)
        assert material(current, before.turn) - material(before, before.turn) == leaf["balance"]
        move(current, leaf["moveUci"])
        COUNTS["replayedSelectedLeaves"] += 1


def causal(report):
    assert len(report["observations"]) == 16
    for row in report["observations"]:
        before = board(row["fen"])
        m = lambda uci: flip(uci, row["reflected"])
        if row["kind"] == "reversed-order":
            first = move(before, row["line"][0])
            after = move(first, row["line"][1])
            assert after.fen() == row["after"]
            assert material(after, before.turn) - material(before, before.turn) == row["materialForOriginalSide"]
            assert len(list(after.legal_moves)) == row["replyCount"]
            for name in ["requestedCapturedValue", "minimum90"]:
                leaf_replay(first, row["line"][1], row[name])
            if row["line"][1] == m("d6e5"):
                assert material(after, before.turn) - material(before, before.turn) == -10
            else:
                returned = move(after, m("a7b6"))
                assert material(returned, before.turn) - material(before, before.turn) == 320
            continue
        root = move(before, m("b6d6"))
        leaf_replay(before, m("b6d6"), row["proof"])
        if row["kind"] == "guard-contrast":
            accepted = move(root, m("d1d6"))
            target = chess.parse_square(m("e5"))
            assert sorted(candidate.uci() for candidate in accepted.legal_moves
                          if candidate.to_square == target) == sorted(row["acceptedTargetCaptures"])
            if row["contrast"] == "missing-g7-bishop":
                assert row["acceptedTargetCaptures"] == []
            else:
                guarded = move(move(before, m("g7e5")), m("d6e5"))
                assert material(guarded, before.turn) - material(before, before.turn) == -10
                no_queen = before.copy(stack=False)
                no_queen.remove_piece_at(chess.parse_square(m("d6")))
                taken = move(no_queen, m("g7e5"))
                extra_guard = chess.Move.from_uci(m("f4e5")) in taken.legal_moves
                assert extra_guard == (row["contrast"] == "additional-f4-guard")
                if extra_guard:
                    returned = move(taken, m("f4e5"))
                    assert material(returned, no_queen.turn) - material(no_queen, no_queen.turn) == -10
            COUNTS["guardContrasts"] += 1
            continue
        assert len(list(root.legal_moves)) == row["rootReplyCount"]
        departures = {candidate.uci() for candidate in root.legal_moves
                      if candidate.from_square == chess.parse_square(m("e5"))}
        assert departures == {item["uci"] for item in row["frontDepartures"]}
        accepted = move(move(root, m("d1d6")), m("g7e5"))
        assert material(accepted, before.turn) - material(before, before.turn) == 320
        assert chess.Move.from_uci(m("b1b7")) not in accepted.legal_moves
        if row["kind"] == "original":
            assert len(departures) == 8
            for departure in departures:
                next_position = move(root, departure)
                for capture, answer, delta in [("d6g3", "h2g3", -800), ("g7c3", "b2c3", -230)]:
                    returned = move(move(next_position, m(capture)), m(answer))
                    assert material(returned, before.turn) - material(next_position, before.turn) == delta
                    COUNTS["rearCaptureRefutations"] += 1
        else:
            for square in ["g3", "h2", "c3", "b2"]:
                assert before.piece_at(chess.parse_square(m(square))) is None
            assert before.piece_at(chess.parse_square(m("b3"))).piece_type == chess.PAWN


def positives(report):
    assert len(report["observations"]) == 4
    for row in report["observations"]:
        before = board(row["fen"])
        m = lambda uci: flip(uci, row["reflected"])
        root = move(before, m("a2b3"))
        assert sorted(candidate.uci() for candidate in root.legal_moves) == sorted(row["rootReplies"])
        assert len(row["rootReplies"]) == 37
        leaf_replay(before, m("a2b3"), row)
        front = move(root, m("c4d4"))
        rear = move(front, m("b3f7"))
        assert material(rear, before.turn) - material(front, before.turn) == 500
        check = move(root, m("c4f1"))
        assert check.is_check()
        recovery = move(check, m("g1f1"))
        assert material(recovery, before.turn) - material(before, before.turn) == (670 if row["capture"] else 570)
        COUNTS["positiveSkewerWitnesses"] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    base = Path(__file__).resolve().parent
    files = ["epyot-causal-adapter174-complete.json", "epyot-causal-adapter175.json",
             "epyot-skewer-preservation-adapter174.json", "epyot-skewer-preservation-adapter175.json"]
    receipts = []
    for name in files:
        data = (base / name).read_bytes()
        report = json.loads(data)
        previous = dict(COUNTS)
        (positives if "skewer-preservation" in name else causal)(report)
        receipts.append({"file": name, "sha256": hashlib.sha256(data).hexdigest(),
                         "version": report["version"], "passed": True,
                         "counts": {key: COUNTS[key] - previous[key] for key in COUNTS}})
    result = {"schemaVersion": 1, "checker": "python-chess", "checkerVersion": chess.__version__,
              "scope": "Independent exact legal-move enumeration, selected-path replay and material arithmetic only. Does not independently verify shared-kernel minimax bounds, later liability, repetition/draw strategy or full-game result. Null proofs remain unknown.",
              "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "receipts": receipts, "totals": COUNTS}
    with Path(args.output).open("x", encoding="utf8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps(COUNTS))


if __name__ == "__main__":
    main()
