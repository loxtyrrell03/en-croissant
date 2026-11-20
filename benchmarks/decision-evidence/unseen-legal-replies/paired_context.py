"""Exploratory verification using a matched reply score in place of root drift."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import chess.engine

from legal_pool import order_questions
from capture_order import Candidate, score
from freeze import read, write
from trials import APP_ORDER, check_order, initial, searched

REPLY_BUDGET = 220_000


def check(row, nomination, engine):
    """Keep selection fixed and spend part of the same budget on reply strength."""
    board = initial(row)
    question = Candidate(**nomination["proposal"])
    option = next(item for item in order_questions(row) if item["proposal"] == nomination["proposal"])
    child = board.copy(stack=True)
    child.push_uci(question.root)
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, fixed, *, reason="reply"):
            return [dict(line, fen=position.fen()) for line in searched(stockfish, position, nodes, width, fixed)]

        comparison = search(child, REPLY_BUDGET, 2, [option["knownReply"], question.reply])
        pair = {item["pvUci"][0]: item for item in comparison if item["pvUci"]}
        safer = score(pair.get(option["knownReply"]), 13)
        queried = score(pair.get(question.reply), 13)
        entry = {name: row[name] for name in ("id", "fen", "site", "history", "recorded", "group", "category")}
        data = dict(entry, candidate=nomination["proposal"], replyComparison=comparison, nodes=REPLY_BUDGET)
        if safer is None or queried is None:
            return dict(data, label="reply-insufficient")
        if safer - queried > 100:
            return dict(data, label="reply-not-competitive")
        verified = check_order(search, board, question, APP_ORDER - REPLY_BUDGET)
    proof = next((line for line in verified["lines"] if line["pvUci"][0] == question.remove), None)
    label = verified["label"]
    if label == "guard-causal" and (proof["cp"] is None or abs(proof["cp"] + queried) > 90):
        label = "reply-score-drift"
    return dict(data, label=label, proof=verified, nodes=APP_ORDER)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("attempts", type=Path)
    parser.add_argument("stockfish")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    frames = {row["id"]: row for row in read(args.frames)}
    tasks = [(frames[row["id"]], choice) for row in read(args.attempts)
             if (choice := row["attempts"].get("linear"))]
    with ThreadPoolExecutor(max_workers=7) as pool:
        results = list(pool.map(lambda item: check(*item, args.stockfish), tasks))
    write(args.output, results)
    print(Counter(row["label"] for row in results), flush=True)
