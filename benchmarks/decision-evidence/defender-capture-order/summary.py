"""Compare cheap nominations and matched searches against the frozen questions."""

import argparse
from collections import Counter
from pathlib import Path
from statistics import median

import chess

from capture_order import Candidate, checkpoint
from freeze import read, write


def key(proposal):
    return tuple(proposal[name] for name in ("root", "reply", "remove", "take"))


def against(app, ref, verified):
    outcomes = Counter()
    for row in app:
        picked = row.get("proposal")
        if verified and (row.get("attempt") or {}).get("label") != "guard-causal":
            picked = None
        target = ref.get(row["id"])
        if not target:
            if picked:
                outcomes["ordinary-calls"] += 1
            continue
        same = bool(picked and key(picked) == key(target["candidate"]))
        if target["label"] == "positive":
            outcomes["true-positive" if same else "false-negative"] += 1
        if target["label"] == "order-harmless":
            outcomes["false-positive" if same else "true-negative"] += 1
        if picked and (not same or target["label"] not in {"positive", "order-harmless"}):
            outcomes["calls-needing-separate-review"] += 1
    return dict(outcomes)


def san(row, item):
    board = chess.Board(row["fen"])
    proposal = Candidate(**item["proposal"])
    child = checkpoint(board, proposal)
    def line(frame):
        return dict(cp=frame["cp"], mate=frame["mate"], depth=frame["depth"],
                    san=child.variation_san([chess.Move.from_uci(uci) for uci in frame["pvUci"][:8]]))
    return dict(prefix=board.variation_san([chess.Move.from_uci(proposal.root), chess.Move.from_uci(proposal.reply)]),
                lines=[line(frame) for frame in item["lines"]], gap=item.get("gap"), role=item.get("guardRole"))


def summarize(app, references, baseline=None):
    reference = {row["id"]: row for row in references}
    base = {row["id"]: row.get("report") for row in baseline or []}
    cases = []
    for row in app:
        target = reference.get(row["id"])
        if (not target or target["label"] not in {"positive", "root-unverified", "reply-unverified", "better-order-unverified"}) and not row.get("proposal"):
            continue
        report = base.get(row["id"]) or {}
        cases.append(dict(
            id=row["id"], source=row.get("site"), group=row.get("group") or row.get("event"), category=row["category"],
            recordedKey=key(target["candidate"]) if target else None,
            appKey=key(row["proposal"]) if row.get("proposal") else None,
            reference=target["label"] if target else None, app=(row.get("attempt") or {}).get("label"),
            refSAN=san(row,target) if target else None, appSAN=san(row,row["attempt"]) if row.get("attempt") else None,
            baselinePosition=(report.get("position") or {}).get("category"),
            baselineMoves={move["moveUci"]: move.get("category") for move in report.get("moves", [])},
        ))
    searches = [s for row in app for s in row["searches"] if s["reason"] == "order"]
    return dict(
        sample=dict(Counter(x["category"] for x in app)), references=dict(Counter(x["label"] for x in references)),
        sources=dict(Counter(x.get("group") or x.get("event") for x in app)),
        geometry=against(app,reference,False), verified=against(app,reference,True),
        optionalCost=dict(searches=len(searches), nodes=sum(s["completed"] for s in searches),
                          medianMs=median(s["ms"] for s in searches) if searches else None),
        cases=cases,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "reference", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--baseline",type=Path)
    args = parser.parse_args()
    result = summarize(read(args.app), read(args.reference), read(args.baseline) if args.baseline else None)
    write(args.output,result)
    print({key:value for key,value in result.items() if key not in {"cases", "sources"}})
