"""Summarize exact replays and distinguish timing from an unrelated plan."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess

from probe import deferred_plan


def replay(path):
    return {row["id"]: row for row in map(json.loads, path.read_bytes().splitlines())}


def classifications(path):
    return {row["id"]: ((row.get("report") or {}).get("position") or {}).get("category")
            for row in json.loads(path.read_bytes())}


def matching(row):
    by_move = {line["move"]: line for line in row.get("matched", {}).get("lines", [])}
    moves = [line["move"] for key in ("broad", "alternate")
             for line in row.get(key, {}).get("lines", [])]
    return [by_move[move] for move in moves] if len(moves) == 2 and set(moves) == by_move.keys() else []


def review(row):
    details = {"status": row["status"]}
    if (pair := matching(row)):
        board = chess.Board(row["checkpoint"])
        best, other = pair
        details.update(option=best["move"], alternate=other["move"], gapCp=row.get("gapCp"))
        details["sameAssetDeferred"] = deferred_plan(
            board, best["move"], other["pv"], (row["kind"], row["squareOrFile"])
        )
        for label, line in zip(("optionSan", "alternateSan"), pair, strict=True):
            details[label] = board.variation_san([chess.Move.from_uci(move) for move in line["pv"][:10]])
    return details


def compare(preview_path, deeper_path, product_path, scope_path):
    preview, deeper = replay(preview_path), replay(deeper_path)
    product = classifications(product_path)
    scoped = json.loads(scope_path.read_bytes())
    assert set(preview) == set(deeper) <= product.keys()
    result = {
        "inputHashes": {
            name: sha256(path.read_bytes()).hexdigest()
            for name, path in (("preview", preview_path), ("deeper", deeper_path),
                               ("product", product_path), ("scope", scope_path))
        },
        "initialBoards": len(scoped),
        "nominatedCheckpoints": len(preview),
        "observedPersistenceInOriginalPreview": sum(x["previewPersistence"] for x in preview.values()),
        "shallow": dict(Counter(r["status"] for r in preview.values())),
        "deeper": dict(Counter(r["status"] for r in deeper.values())),
        "cost": {},
        "cases": [],
    }
    for name, rows in (("shallow", preview), ("deeper", deeper)):
        calls = [[row[arm] for arm in ("broad", "alternate", "matched") if arm in row] for row in rows.values()]
        result["cost"][name] = {
            "queries": sum(map(len, calls)),
            "medianMsIncludingEarlierSearches": round(median(sum(run["ms"] for run in entry) for entry in calls), 1),
            "medianNodesIncludingEarlierSearches": round(median(sum(run["maxNodes"] for run in entry) for entry in calls)),
        }
    for identity, a in preview.items():
        b = deeper[identity]
        if a["status"] != "nominated" and b["status"] != "nominated":
            continue
        before, after = review(a), review(b)
        result["cases"].append({
            "id": identity, "kind": a["kind"], "fen": a["fen"],
            "event": a.get("event"), "site": a.get("site"), "prefix": a["prefix"],
            "currentPositionCategory": product[identity],
            "positionReference": a["label"] if (a.get("label") or {}).get("scope") == "position-character" else None,
            "initialPersistence": a["previewPersistence"],
            "before": before, "after": after,
            "repeat": a["status"] == b["status"] == "nominated" and before["option"] == after["option"],
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("preview", "deeper", "product", "scope", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    result = compare(args.preview, args.deeper, args.product, args.scope)
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(result, file, indent=2, ensure_ascii=False)
        file.write("\n")
    print({key: result[key] for key in ("initialBoards", "nominatedCheckpoints", "shallow", "deeper", "cost")})
    print("repeated exact plan move", sum(row["repeat"] for row in result["cases"]))


if __name__ == "__main__":
    main()
