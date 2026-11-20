"""Compare one-slot capture-order selectors using the same completed Stockfish frames."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
import sys
from time import perf_counter

import chess.engine

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from capture_order import nomination, score
from freeze import read, write
from generated import generated_candidate
from trials import APP_ORDER, ROOT_RELEVANCE, check_order, initial, searched, within

REPLY_RELEVANCE = 100
ROOT_REPLY_DRIFT = 90


def root_options(row):
    lines = row["candidates"]
    if not lines:
        return []
    return [lines[0], *(line for line in lines[1:] if within(lines, line["pvUci"][0], ROOT_RELEVANCE))]


def plausible_replies(root, replies):
    best = replies[0] if replies else None
    root_cp = score(root)
    best_cp = score(best)
    if root_cp is None or best_cp is None or abs(root_cp + best_cp) > ROOT_REPLY_DRIFT:
        return
    for reply in replies:
        value = score(reply)
        if value is not None and reply["depth"] == best["depth"] and best_cp - value <= REPLY_RELEVANCE:
            yield reply


def search_paths(row):
    roots = root_options(row)
    for root in roots:
        yield "principal", root["pvUci"]
    for root in roots:
        uci = root["pvUci"][0]
        probe = next((p["lines"] for p in row.get("replyProbes", []) if p["moveUci"] == uci), [])
        for line in plausible_replies(root, probe):
            yield "reply", [uci, *line["pvUci"]]


def choices(board, row):
    """Only use search results available before the extra paired search."""
    paths = list(search_paths(row))
    found = {}
    for source, path in paths:
        if proposal := nomination(board, path):
            found.setdefault(proposal, []).append(source)
    cached = next(iter(found), None)
    corroborated = next((p for p, sources in found.items() if len(sources) > 1), cached)
    generated = cached or generated_candidate(board, [path for _, path in paths])
    return found, {"cached": cached, "agreement": corroborated, "generated": generated}


def assess(row, binary):
    board = initial(row)
    found, selections = choices(board, row)
    proofs = {}
    if row.get("proposal"):
        original = next((candidate for candidate in found if asdict(candidate) == row["proposal"]), None)
        if original is not None:
            proofs[original] = row["attempt"]
    unsearched = {candidate for candidate in selections.values() if candidate and candidate not in proofs}
    timings = []
    if unsearched:
        with chess.engine.SimpleEngine.popen_uci(binary, timeout=45) as engine:
            engine.configure({"Threads": 1, "Hash": 64})

            def search(position, nodes, width, fixed, *, reason):
                started = perf_counter()
                lines = searched(engine, position, nodes, count=width, fixed=fixed)
                timings.append(dict(ms=round((perf_counter() - started) * 1000), reason=reason))
                return [dict(line, fen=position.fen()) for line in lines]

            for candidate in sorted(unsearched, key=lambda c: (c.root, c.reply, c.remove, c.take)):
                proofs[candidate] = check_order(search, board, candidate, APP_ORDER)
    return dict(
        row, selections={key: proofs.get(candidate) for key, candidate in selections.items()},
        pool=[dict(proposal=asdict(candidate), sources=sources) for candidate, sources in found.items()],
        selectorCosts=timings,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("common", type=Path)
    parser.add_argument("stockfish")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    common = read(args.common)
    with ThreadPoolExecutor(max_workers=6) as workers:
        results = list(workers.map(lambda row: assess(row, args.stockfish), common))
    write(args.output, results)
    for arm in ("cached", "agreement", "generated"):
        print(arm, Counter((row["selections"][arm] or {}).get("label", "no-proposal") for row in results))
