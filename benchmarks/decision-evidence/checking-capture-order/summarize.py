"""Summarize the unchanged reference searches and both explanation variants."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median


def read(path):
    return json.loads(path.read_bytes())


def summarize(frames, checks):
    rows = read(checks)
    labels = {row["id"]: row["label"] for row in read(frames)}
    assert set(labels) == {row["id"] for row in rows}
    supported = [row for row in rows if row.get("proof")]
    queried = [row for row in rows if row.get("queries")]
    return {
        "games": len(rows),
        "eventFamilies": len({row["event"] for row in rows}),
        "reference": Counter(labels.values()),
        "nominated": sum(row["mistakeNominated"] or row["positionNominated"] for row in rows),
        "detected": Counter(labels[row["id"]] for row in supported),
        "missedKnownPositive": sum(labels[row["id"]] == "different-order-outcome" and not row.get("proof") for row in rows),
        "extraQueries": sum(len(row["queries"]) for row in queried),
        "medianQueriedMilliseconds": median([row["milliseconds"] for row in queried]) if queried else None,
        "examples": supported,
    }


def screens(checks):
    rows = read(checks)
    return {
        "positions": len(rows),
        "checkThenCaptureShape": sum(row["broadCount"] for row in rows),
        "causalNomination": sum(row["positionNominated"] or row["mistakeNominated"] for row in rows),
        "confirmed": [row for row in rows if row.get("proof")],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    lab = args.lab
    inputs = [
        lab / "played-holdout.json", lab / "played-frames.json", lab / "new-holdout.json",
        lab / "new-frames.json", lab / "reserve/holdout.json", lab / "reserve/requests.json",
    ]
    result = {
        "engineSha256": sha256(args.engine.read_bytes()).hexdigest(),
        "inputs": {p.relative_to(lab).as_posix(): sha256(p.read_bytes()).hexdigest() for p in inputs},
        "retainedScreen": screens(lab / "archive.json"),
        "pairedDevelopment": screens(lab / "paired-ranked.json"),
        "ordinaryReserve": screens(lab / "reserve/checks.json"),
        "recordedOrderDevelopment": {
            "materialOnly": summarize(lab / "played-frames.json", lab / "played-material.json"),
            "retainedMaterialOrCounterattack": summarize(lab / "played-frames.json", lab / "played-checks-b.json"),
        },
        "recordedOrderHoldout": {
            "materialOnly": summarize(lab / "new-frames.json", lab / "new-material.json"),
            "retainedMaterialOrCounterattack": summarize(lab / "new-frames.json", lab / "new-checks.json"),
        },
    }
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(result, out, ensure_ascii=False, indent=2)
        out.write("\n")
