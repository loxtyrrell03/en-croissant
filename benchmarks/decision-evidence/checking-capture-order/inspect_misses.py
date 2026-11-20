"""Inspect held-out misses by replaying the same check after the stronger choice."""
import argparse
import json
from pathlib import Path

import chess

from played_transfer import cp, engines, initial, select_lines


def explain(root, result, exe):
    board = initial(root)
    best, played = root["comparisonCandidates"]
    check = chess.Move.from_uci(root["checkingMove"])
    take = chess.Move.from_uci(root["directCapture"])
    preferred = board.parse_uci(best["pvUci"][0])
    actual = board.parse_uci(played["pvUci"][0])
    record = {
        "id": root["id"], "event": root["event"], "site": root["site"],
        "betterSan": board.san(preferred), "playedSan": board.san(actual),
        "explained": bool(result.get("proof")),
        "rootShowsOrder": played["pvUci"][1:2] == [check.uci()] and played["pvUci"][3:4] == [take.uci()],
    }
    if record["explained"]:
        return record
    after = board.copy()
    after.push(actual)
    target = actual.from_square if actual.to_square == take.to_square else take.to_square
    record.update({
        "betterMovesOriginalTarget": preferred.from_square == target,
        "firstReplySan": after.san(check),
        "exactImmediateCaptureSan": after.san(take),
    })
    strong = board.copy()
    strong.push(preferred)
    if check not in strong.legal_moves:
        record["afterBetter"] = "The checking move is illegal"
        return record
    exact = select_lines(strong, exe, 2_400_000, 1, [check])
    if exact:
        line = exact[0]
        earlier = next(frame for frame in root["orderReference"] if frame["pvUci"][0] == check.uci())
        record.update({
            "afterBetter": strong.variation_san([chess.Move.from_uci(move) for move in line["pvUci"][:6]]),
            "checkScoreAfterBetterCp": line["cp"],
            "checkScoreAfterPlayedCp": earlier["cp"],
            "sameReplyScoreChangeCp": cp(earlier) - cp(line),
            "restrictedLine": line,
        })
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("reference", "results", "engine", "output"):
        parser.add_argument(field, type=Path)
    args = parser.parse_args()
    reference = json.loads(args.reference.read_bytes())
    results = {row["id"]: row for row in json.loads(args.results.read_bytes())}
    try:
        rows = [explain(row, results[row["id"]], str(args.engine)) for row in reference
                if row["label"] == "different-order-outcome"]
        with args.output.open("x", encoding="utf-8") as file:
            json.dump(rows, file, ensure_ascii=False, indent=2)
            file.write("\n")
    finally:
        for worker in engines:
            worker.quit()
