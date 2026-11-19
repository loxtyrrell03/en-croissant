"""Search a candidate's opponent reply afresh to test exchange corroboration."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.engine

from screen import confirm, sequence


def load(path):
    return json.loads(path.read_bytes())


def inspect(bundle):
    item, screened, executable, study = bundle
    lines = (item.get("comparisonCandidates") if screened["scope"] == "mistake" else None) or item["candidates"]
    best = lines[0]
    alt = next(line for line in lines[1:] if line["pvUci"][0] == screened["candidate"])
    board = chess.Board(item["fen"])
    child = board.copy(stack=False)
    move = child.parse_uci(alt["pvUci"][0])
    child.push(move)
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        cost = []
        for budget in study.REPLY_BUDGETS:
            replies, receipt = study.search.search_replies(engine, child, min(child.legal_moves.count(), 3), budget)
            cost.append(receipt)
            if replies[0]["depth"] >= 16 and study.agrees(alt, replies[0]):
                break
    support = {}
    if replies[0]["depth"] >= 16 and study.agrees(alt, replies[0]):
        support = confirm(board, sequence(board, best["pvUci"]), sequence(board, alt["pvUci"]),
                          sequence(board, [move.uci(), *replies[0]["pvUci"]]))
    return {**screened, "confirm": support, "probe": {"moveUci": move.uci(), "lines": replies}, "cost": cost}


if __name__ == "__main__":
    inputs, screens, output, stockfish = map(Path, sys.argv[1:])
    source = Path("benchmarks/decision-evidence/opened-rook-file/prepare.py")
    spec = importlib.util.spec_from_file_location("study", source)
    study = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(study)
    rows = {row["id"]: row for row in load(inputs)}
    tasks = [(rows[row["id"]], row, stockfish, study) for row in load(screens)]
    checked = []
    with ThreadPoolExecutor(5) as pool:
        for result in pool.map(inspect, tasks):
            checked.append(result)
            if result["confirm"]:
                print(result["id"], result["label"]["tactical"], list(result["confirm"]), flush=True)
    output.write_text(json.dumps(checked, ensure_ascii=False, indent=2), encoding="utf-8")
