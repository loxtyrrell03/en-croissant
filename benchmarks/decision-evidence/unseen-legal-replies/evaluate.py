"""Test unseen-reply nomination at a matched per-board Stockfish node cap."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import perf_counter

import chess.engine
import joblib

from legal_pool import order_questions, material_order
from capture_order import Candidate, score
from collect import priority
from fit import ARMS, predict
from freeze import read, write
from summary import key
from trials import APP_ORDER, check_order, initial, searched

PREVIEW = 150_000
NOMINEES = 8


def engine_candidate(search, board, ranked):
    root = ranked[0]["proposal"]["root"]
    after = board.copy(stack=True)
    after.push_uci(root)
    replies = {}
    for option in ranked:
        item = option["proposal"]
        if item["root"] == root:
            replies.setdefault(item["reply"], option)
        if len(replies) == NOMINEES:
            break
    if len(replies) == 1:
        return next(iter(replies.values())), APP_ORDER
    lines = search(after, PREVIEW, len(replies), list(replies), reason="preview")
    first = next((line for line in lines if score(line, 9) is not None), None)
    selected = replies[first["pvUci"][0]] if first else ranked[0]
    return selected, APP_ORDER - PREVIEW


def select(row, engine, models):
    board = initial(row)
    options = sorted((option for option in order_questions(row) if option["unseen"]),
                     key=lambda item: priority(row["id"], item))
    common = {name: row[name] for name in ("id", "fen", "history", "site", "group", "category", "recorded")}
    candidate = row.get("candidate")
    heldout_visible = any(q["proposal"] == candidate for q in options)
    if not options:
        return dict(common, pool=0, referenceInPool=False, attempts={}, searches=[])
    predictions = predict(models, options)
    selected = {arm: options[max(range(len(options)), key=lambda i: predictions[arm][i])] for arm in ARMS}
    ranked = sorted(options, key=material_order, reverse=True)
    searches = []
    with chess.engine.SimpleEngine.popen_uci(engine, timeout=45) as stockfish:
        stockfish.configure({"Threads": 1, "Hash": 64})

        def search(position, nodes, width, fixed, *, reason):
            started = perf_counter()
            lines = searched(stockfish, position, nodes, count=width, fixed=fixed)
            searches.append(dict(reason=reason, budget=nodes,
                                 nodes=max((line["nodes"] for line in lines), default=0),
                                 ms=round((perf_counter()-started)*1000)))
            return [dict(line, fen=position.fen()) for line in lines]

        preview, budget = engine_candidate(search, board, ranked)
        selected["preview"] = preview
        finished = {}
        for arm, question in selected.items():
            nodes = budget if arm == "preview" else APP_ORDER
            identity = key(question["proposal"]), nodes
            if identity not in finished:
                finished[identity] = check_order(search, board, Candidate(**question["proposal"]), nodes)
    attempts = {}
    for arm, question in selected.items():
        nodes = budget if arm == "preview" else APP_ORDER
        result = finished[key(question["proposal"]), nodes]
        first = next((line for line in result["lines"]
                      if line["pvUci"][0] == question["proposal"]["remove"]), None)
        if (result["label"] == "guard-causal"
                and (first["cp"] is None or abs(first["cp"] - question["evalCp"]) > 90)):
            result = dict(result, label="root-score-drift")
        attempts[arm] = dict(result, budget=nodes)
    return dict(common, pool=len(options), referenceInPool=heldout_visible, attempts=attempts, searches=searches)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("stockfish")
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", type=int, default=7)
    args = parser.parse_args()
    model = joblib.load(args.model)
    cases = read(args.frames)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = []
        for i, row in enumerate(pool.map(lambda item: select(item, args.stockfish, model), cases), 1):
            results.append(row)
            if i % 24 == 0:
                print(i, len(cases), flush=True)
    write(args.output, results)
    for arm in (*ARMS, "preview"):
        print(arm, Counter(row["attempts"].get(arm, {}).get("label","no-option") for row in results), flush=True)
