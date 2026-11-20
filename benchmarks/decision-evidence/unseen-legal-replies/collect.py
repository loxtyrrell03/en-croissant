"""Create independently checked supervision for legal capture-order questions."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from time import perf_counter

import chess.engine

from legal_pool import order_questions, material_order
from capture_order import Candidate, checkpoint, comparison, score
from freeze import read, write
from summary import key
from trials import initial, searched

SCREEN = 120_000
RESOLUTION = 620_000
REPLY_NODES = 450_000


def priority(identifier, item):
    return sha256((identifier + "|".join(key(item["proposal"]))).encode()).hexdigest()


def sample_questions(board, options, reference):
    # Reserve both easy and difficult questions without giving the model
    # access to selection origin, the recorded reply, or source identity.
    ordered = sorted(options, key=lambda item: priority(board, item))
    strongest = sorted(ordered, key=material_order, reverse=True)[:6]
    generated = strongest + [item for item in ordered if item not in strongest][:12]
    return generated + [item for item in options
                        if (board, key(item["proposal"])) in reference and item not in generated]


def reply_gap(search, board, candidate, fallback):
    if candidate.reply == fallback:
        return 0
    after = board.copy(stack=True)
    after.push_uci(candidate.root)
    lines = search(after, REPLY_NODES, [fallback, candidate.reply])
    scores = {line["pvUci"][0]: score(line, 13) for line in lines if line["pvUci"]}
    preferred, tested = scores.get(fallback), scores.get(candidate.reply)
    return preferred - tested if preferred is not None and tested is not None else None


def get_label(search, board, item):
    question = Candidate(**item["proposal"])
    reached = checkpoint(board, question)
    moves = [question.remove, question.take]
    preview = comparison(reached, question, search(reached, SCREEN, moves), floor=11)
    if preview["label"] not in {"order-harmless", "guard-causal"}:
        return "unverified"
    detailed = search(reached, RESOLUTION, moves)
    try_again = comparison(reached, question, detailed, floor=14)
    if try_again["label"] != preview["label"]:
        return "unverified"
    if try_again["label"] == "order-harmless":
        return "order-harmless"
    if try_again["guardRole"] != preview["guardRole"]:
        return "unverified"
    strong = next((line for line in detailed if line["pvUci"][0] == question.remove), None)
    if not strong or strong["cp"] is None or abs(strong["cp"] - item["evalCp"]) > 90:
        return "unverified"
    gap = reply_gap(search, board, question, item["knownReply"])
    if gap is None:
        return "unverified"
    if gap > 150:
        return "uncompetitive-reply"
    return "positive" if gap <= 100 else "unverified"


def collect(row, engine, reference):
    board = initial(row)
    options = list(order_questions(row))
    chosen = sample_questions(row["id"], options, reference)
    if not chosen:
        return []
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, roots):
            return searched(stockfish, position, nodes, count=len(roots), fixed=roots)

        labeled = []
        for option in chosen:
            established = reference.get((row["id"], key(option["proposal"])))
            if established:
                label, source = established, "prior-deep"
            else:
                label, source = get_label(search, board, option), "new-screen"
            labeled.append(dict(option, id=row["id"], group=row["group"], label=label, source=source))
        return labeled


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stockfish")
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", nargs="+", required=True, type=Path)
    parser.add_argument("--labels", nargs="+", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    cases = [row for path in args.frames for row in read(path)]
    known = {(row["id"], key(row["candidate"])): row["label"] for path in args.labels for row in read(path)
             if row["label"] in {"positive", "order-harmless", "reply-unverified"}}
    known = {key: ("uncompetitive-reply" if label == "reply-unverified" else label) for key, label in known.items()}
    start = perf_counter()
    labeled = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, result in enumerate(pool.map(lambda row: collect(row, args.stockfish, known), cases), 1):
            labeled.extend(result)
            if i % 24 == 0:
                print(i, len(cases), len(labeled), Counter(item["label"] for item in labeled), flush=True)
    write(args.output, labeled)
    print(round(perf_counter()-start, 1), len(labeled), Counter(item["label"] for item in labeled), flush=True)
