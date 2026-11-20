"""Rebuild matched decision frames from previously frozen local inputs."""

import argparse
import json
from pathlib import Path

import chess


BENCHMARKS = Path(__file__).resolve().parent.parent


def read(path):
    return json.loads(path.read_bytes())


def write(path, data):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, separators=(",", ":"))


def matched(lab):
    inputs = {
        "archive": lab / "reply-coverage-audit/full-pair-input.json",
        "public-transfer": lab / "alternate-capture-payoff/fresh-scored.json",
        "outpost-reserve": BENCHMARKS / "outposts-after-exchanges/reserve.json",
        "prospective": lab / "current-classifier-audit/prospective-scored.json",
    }
    rows = []
    for group, path in inputs.items():
        for row in read(path):
            pair = row.get("comparisonCandidates")
            if pair and len(pair) >= 2 and len(pair[0]["pvUci"]) >= 2 and row.get("candidates"):
                rows.append(dict(row, id=group + ":" + row["id"]))
    return rows


def deeper_mixed(lab):
    reference = read(BENCHMARKS / "promotion-intermezzo/mixed-reference-reviewed.json")
    archive = {row["id"]: row for row in read(lab / "reply-coverage-audit/full-pair-input.json")}
    rows = []
    for ref in reference:
        original = archive[ref["id"]]
        pair = [dict(line, fen=ref["fen"], mate=line.get("mate")) for line in ref["deeperPairedSearch"]]
        replies = []
        for move, reply in ref["independentReplies"].items():
            if not reply:
                continue
            board = chess.Board(ref["fen"])
            board.push_uci(move)
            replies.append(dict(moveUci=move, lines=[dict(reply, fen=board.fen(), mate=reply.get("mate"))]))
        game = {key: original[key] for key in ("id", "fen", "playedMoveUci", "history") if key in original}
        rows.append(dict(game, candidates=pair, comparisonCandidates=pair, replyProbes=replies))
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("matched", "deeper_mixed"))
    parser.add_argument("lab", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    builder = matched if args.mode == "matched" else deeper_mixed
    write(args.output, builder(args.lab))
