"""Create a review packet without showing any candidate classifier verdicts."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.engine

from capture import initial, searched
from freeze import load_index, ticket
from ray_review import aligned_after_reply, evaluated, prefix


def question(row):
    root = initial(row)
    played, recorded_reply = row["recorded"][:2]
    better = row["candidates"][0]["pvUci"][0]
    actual = prefix(root, [played])
    context = evaluated(row)
    reply = context[3]["pvUci"][0] if context else recorded_reply
    move = chess.Move.from_uci(reply)
    targets = aligned_after_reply(actual, chess.Move.from_uci(played).to_square, move)
    return row, better, played, reply, targets


def review_selection(rows):
    questions = [question(row) for row in rows]
    chosen = []
    for kind, limit in (("recordedCapture", 14), ("ray", 10), ("ordinary", 8)):
        available = [q for q in questions if q[0]["category"] == kind and not evaluated(q[0])]
        chosen.extend(sorted(available, key=lambda q: ticket("blind-shared-ray", q[0]["id"]))[:limit])
    return [q for q in questions if evaluated(q[0])] + chosen


def analyse(binary, question):
    row, better, played, reply, targets = question
    root = initial(row)
    actual = prefix(root, [played])
    alternative = prefix(root, [better])
    child_played = prefix(actual, [reply])
    source = dict(id=row["id"], cohort=row["category"], source=row["site"], fen=root.fen(),
                  played=played, comparison=better, reply=reply,
                  geometry=[[chess.square_name(square) for square in pair] for pair in targets])
    if not targets:
        return dict(source, checks=None)

    with chess.engine.SimpleEngine.popen_uci(binary, timeout=45) as engine:
        engine.configure({"Threads": 1, "Hash": 64})

        def inspect(board, nodes, width, choices=None):
            lines = searched(engine, board, nodes, count=width, fixed=choices)
            return [dict(line, san=board.variation_san([chess.Move.from_uci(uci)
                                                       for uci in line["pvUci"][:10]]))
                    for line in lines]

        choices = inspect(root, 7_200_000, 2, [played, better]) if better != played else []
        punishment = inspect(actual, 4_000_000, 3)
        after_reply = inspect(child_played, 5_400_000, 3)
        control = None
        if chess.Move.from_uci(reply) in alternative.legal_moves:
            control = inspect(prefix(alternative, [reply]), 5_400_000, 2)
    return dict(source, checks=dict(choices=choices, punishment=punishment,
                                   playedAfterReply=after_reply, betterAfterReply=control))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine")
    parser.add_argument("output", type=Path)
    parser.add_argument("frames", nargs="+", type=Path)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    rows = [row for path in args.frames for row in load_index(path)]
    questions = review_selection(rows)
    print("Reading exact engine lines for", len(questions), "decisions", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        cases = list(executor.map(lambda item: analyse(args.engine, item), questions))
    receipt = dict(engineSha256=sha256(Path(args.engine).read_bytes()).hexdigest(),
                   frames=[dict(path=path.name, sha256=sha256(path.read_bytes()).hexdigest()) for path in args.frames],
                   cases=cases)
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
