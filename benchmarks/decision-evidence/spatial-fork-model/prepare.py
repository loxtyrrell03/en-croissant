"""Reuse frozen game searches and gather matching quick replies for two audits."""

import argparse
import hashlib
import json
from pathlib import Path

import chess
import chess.engine

from experiment import baseline, board_identity, payoff


def quick_row(case, split, engine):
    board = chess.Board(case["fen"])
    action = board.parse_uci(case["move"])
    if not payoff.geometry(board, action):
        raise ValueError("Expected eligible fork geometry")
    identity = dict(case, split=split, boardKey=board_identity(board))
    board.push(action)
    return dict(identity=identity, fen=case["fen"], move=case["move"], label=None,
                quick=payoff.search(engine, board, payoff.QUICK_NODES))


def prepare(lab, executable):
    old = lab / "exact-fork-supervision"
    audit = lab / "neural-motif-transfer"
    classical = baseline.load_cache(old / "classical", "classical")
    reserve = payoff.read(old / "reserve.json")["cases"]
    reviewed_audit = payoff.read(audit / "fork-audit-reference.json")["cases"]
    audit_cases = []
    for case in payoff.read(audit / "fork-audit.json")["cases"]:
        board = chess.Board(case["fen"])
        move = board.parse_uci(case["line"][0])
        if payoff.geometry(board, move):
            audit_cases.append({**{key: case[key] for key in ("id", "game", "fen")},
                                "move": move.uci(), "origin": "solution"})
    retained = {case["id"] for case in audit_cases}
    reviews = {
        "classical": payoff.read(old / "reference.json")["cases"],
        "reserve": payoff.read(old / "reserve-reference.json")["cases"],
        "puzzle-audit": [case for case in reviewed_audit if case["id"] in retained]
    }
    incumbent = payoff.read(old / "incumbent.json")
    incumbent.update({case["id"]: "fork" in case["rootMotifs"]
                      for case in payoff.read(old / "reserve-result.json")})
    audit_legacy = payoff.read(audit / "legacy-audit.json")["fork-audit-engine"]
    incumbent.update({key: "fork" in audit_legacy[key]["root"] for key in retained})
    fingerprint = payoff.read(old / "classical/receipt.json")["fingerprint"]
    sha = hashlib.sha256(executable.read_bytes()).hexdigest()
    if sha != fingerprint["engine"] or payoff.QUICK_NODES != fingerprint["quickNodes"]:
        raise ValueError("The transfer must use the same binary and quick-search budget")
    with chess.engine.SimpleEngine.popen_uci(str(executable)) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        additions = [quick_row(case, split, engine)
                     for split, cases in (("reserve", reserve), ("puzzle-audit", audit_cases))
                     for case in cases]
    cached = payoff.read(old / "model.json")["classicalPredictions"]["reply-network"]
    return dict(rows=[*classical, *additions], reviews=reviews, incumbent=incumbent,
                cachedPredictions={"classical": cached}, engine=sha,
                excludedFromPuzzleAudit=len(reviewed_audit) - len(audit_cases))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    bundle = prepare(args.research, args.engine)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(bundle, file, sort_keys=True)
