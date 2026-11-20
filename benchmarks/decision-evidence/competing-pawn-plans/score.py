"""Score scoped strategic nominations without converting unknowns to negatives."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def evaluate(replay, reference=None):
    original = read(replay)
    ids = {row["id"] for row in original}
    assert len(ids) == len(original)
    deeper = {row["id"]: row for row in read(reference)} if reference else {}
    assert not deeper or ids == deeper.keys()
    result = {
        "count": len(original),
        "originalPositions": dict(Counter((row["original"] or {}).get("category") for row in original)),
        "originalLeadingMoves": dict(Counter(row["oldRoot"] for row in original)),
        "medianExperimentalMs": round(median(row["elapsedMs"] for row in original), 3),
        "methods": {},
    }
    if reference:
        result["sameLeadingMoveDeeper"] = sum(case["retainsFirst"] for case in deeper.values())
        result["deeperRootRookUseInBoth"] = sum(
            case["retainsFirst"] and any(item["rook"] and item["repeatedRook"] for item in case["repeatedBreak"])
            for case in deeper.values()
        )
    for method in ("broad", "strict", "delayedPlans", "repeated", "delayed"):
        root = method in ("repeated", "delayed")
        nominates = [row for row in original if row.get(method) and (not root or row[method]["rookInBoth"])]
        additions = []
        for row in nominates:
            category = row["oldRoot"] if root else (row["original"] or {}).get("category")
            if category not in ("unclear", "tactical"):
                continue
            proof = row[method]
            detail = dict(id=row["id"], before=category, description=proof["description"],
                          linesUci=proof["linesUci"])
            if root and reference:
                check = deeper[row["id"]]
                matching = [item for item in check["repeatedBreak"]
                            if item["file"] == proof["file"] and item["target"] == proof["target"]]
                detail["deeper"] = (
                    "changed leading move" if not check["retainsFirst"]
                    else "rook use repeats" if any(item["rook"] and item["repeatedRook"] for item in matching)
                    else "rook use appears once" if any(item["rook"] or item["repeatedRook"] for item in matching)
                    else "exchange repeats without demonstrated rook access" if matching
                    else "exchange did not repeat"
                )
            additions.append(detail)
        result["methods"][method] = dict(nominations=len(nominates), possibleAdditions=additions)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    root=args.raw
    results = dict(
        development=evaluate(root / "development-v2-replay.json"),
        firstReserve=evaluate(root/"reserved-v2-replay.json",root/"reference-v2-frozen.json"),
        secondReserve=evaluate(root/"replication-replay.json",root/"replication-reference-frozen.json"),
        historicalReviewed=evaluate(root/"older-reviewed-v2-replay.json"),
    )
    results["manifests"] = {
        cohort: dict(pgns=read(root / f"{cohort}-manifest.json"), populationSha256=digest(root/f"{cohort}.json"),
                     appFramesSha256=digest(root/f"{cohort}-scored.json"))
        for cohort in ("development","reserved","replication")
    }
    with args.output.open("x",encoding="utf-8") as target:
        json.dump(results,target,ensure_ascii=False,indent=2)
        target.write("\n")


if __name__=="__main__":
    main()
