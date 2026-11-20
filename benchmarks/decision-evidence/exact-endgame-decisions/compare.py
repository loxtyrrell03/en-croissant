"""Check reported consequences with python-chess and compare the engine-only replay."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import chess

from counterfactual import OUTCOME


def read(path):
    return json.loads(path.read_bytes())


def verify_reply(board, played, certificate, reviewed):
    reached = board.copy()
    moved = board.piece_at(played.from_square)
    reached.push(played)
    records = {record["fen"]: record["result"] for record in certificate["records"]}
    reply = reached.parse_san(reviewed["san"])
    exact = records[reached.fen()]
    assert {item["uci"] for item in exact["moves"]} == {m.uci() for m in reached.legal_moves}
    item = next(item for item in exact["moves"] if item["uci"] == reply.uci())
    assert -OUTCOME[item["category"]] == OUTCOME[exact["category"]]
    if not reviewed.get("cause"):
        return "optimal-reply"
    if reviewed.get("capturedMover"):
        assert board.piece_type_at(played.to_square) in (None, chess.PAWN)
        assert reply.to_square == played.to_square and reached.piece_at(reply.to_square) == moved
        assert reached.is_capture(reply)
        reached.push(reply)
        assert not any(m.to_square == reply.to_square for m in reached.legal_moves)
        return "unrecaptured-piece"
    reached.push(reply)
    assert reached.is_checkmate()
    return "mate-in-one"


def compare(sample, records, outputs, baseline):
    ids = {row["id"]: row for row in sample["sample"]}
    legacy = {row["id"]: row.get("report") for row in baseline}
    receipts = {row["id"]: row for row in records}
    assert ids.keys() == legacy.keys() == receipts.keys() == {row["id"] for row in outputs}
    summary, cases = Counter(), []
    for row in outputs:
        case_id = row["id"]
        request = ids[case_id]
        certificate = receipts[case_id].get("evidence")
        summary["games"] += 1
        summary["requests"] += row["requests"]
        summary["maximumRequests"] = max(summary["maximumRequests"], row["requests"])
        if not certificate:
            summary["unavailable"] += 1
            continue
        board = chess.Board(request["fen"])
        assert certificate["records"][0]["fen"] == board.fen()
        exact_root = certificate["records"][0]["result"]
        exact_moves = {m["uci"]: -OUTCOME[m["category"]] for m in exact_root["moves"]}
        assert exact_moves.keys() == {m.uci() for m in board.legal_moves}
        assert len(exact_root["moves"]) == len(exact_moves)
        assert max(exact_moves.values()) == OUTCOME[exact_root["category"]] == row["bestOutcome"]
        assert exact_moves[request["playedMoveUci"]] == row["played"]["outcome"]
        summary["verified"] += 1
        if legacy[case_id] is None:
            summary["verifiedWithoutCompleteEngineReport"] += 1
        if row["played"]["outcome"] == row["bestOutcome"]:
            summary["sameOutcome"] += 1
            assert not row["played"].get("reply")
            continue
        summary["worseOutcome"] += 1
        before = (legacy[case_id] or {}).get("mistake") or {}
        prior = before.get("tactical", {}).get("support") == "supported"
        reviewed = row["played"].get("reply")
        kind = verify_reply(board, board.parse_uci(request["playedMoveUci"]), certificate, reviewed) if reviewed else None
        if kind:
            summary[kind] += 1
        if kind in ("unrecaptured-piece", "mate-in-one"):
            summary["namedTacticalProof"] += 1
            if not prior:
                summary["newTacticalExplanation"] += 1
        cases.append({
            "id": case_id, "site": request["site"], "fen": request["fen"],
            "oldMistakeCategory": before.get("category"),
            "previousTacticalSupport": prior,
            "bestOutcome": row["bestOutcome"], "played": row["played"], "verifiedReplyKind": kind,
        })
    return {"counts": dict(summary), "cases": cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("sample", "records", "outputs", "baseline", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    paths = (args.sample, args.records, args.outputs, args.baseline)
    results = compare(*map(read, paths))
    results["inputHashes"] = {p.name: sha256(p.read_bytes()).hexdigest() for p in paths}
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(results, file, indent=2, ensure_ascii=False)
        file.write("\n")
    print(results["counts"])


if __name__ == "__main__":
    main()
