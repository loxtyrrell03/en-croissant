"""Compare saved worker outputs and keep compact public evidence."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median


def read(file):
    return json.loads(file.read_bytes())


def compare(lab, baseline, candidate):
    left, right = [read(lab / f"{name}.json") for name in (baseline, candidate)]
    assert [row["id"] for row in left] == [row["id"] for row in right]
    changed, counts = [], Counter()
    for before, after in zip(left, right, strict=True):
        a, b = before["assessment"], after["assessment"]
        if a is None or b is None:
            assert a is b
            continue
        counts["reports"] += 1
        a.pop("version")
        b.pop("version")
        assert a["position"] == b["position"] and a["mistake"] == b["mistake"]
        assert a["mistakeStatus"] == b["mistakeStatus"]
        if a == b:
            continue
        assert a["moves"][1:] == b["moves"][1:]
        leader = b["moves"][0]
        assert leader["promotionTactic"] and leader["category"] == "mixed"
        changed.append({
            "id": after["id"], "before": a["moves"][0]["category"], "after": leader["category"],
            "evidence": leader["promotionTactic"], "positional": leader["positional"]["reasons"],
        })
    return {
        "inputs": len(left), "validReports": counts["reports"], "changed": changed,
        "baselineMedianMs": round(median(row["ms"] for row in left), 3),
        "productMedianMs": round(median(row["ms"] for row in right), 3),
    }


def nominations(lab, name):
    items = read(lab / f"{name}.json")
    return {
        "inputs": len(items),
        "exact": [row["id"] for row in items if any(hit["exact"] for hit in row.get("hits", []))],
        "samePawn": [row["id"] for row in items if row.get("hits")],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    path = args.lab
    reference = read(path / "fresh-scored.json")
    live = read(path / "live-product-final.json")
    report = {
        "base": "e624c951",
        "freshSampleSha256": sha256((path / "fresh.json").read_bytes()).hexdigest(),
        "freshFramesSha256": sha256((path / "fresh-scored.json").read_bytes()).hexdigest(),
        "cachedSources": read(path / "cached-manifest.json"),
        "freshExclusions": read(path / "fresh-exclusions.json"),
        "cachedArms": nominations(path, "cached-final-results"),
        "freshArms": nominations(path, "fresh-final-results"),
        "freshEvents": len({row["event"] for row in reference}),
        "freshFrameStatuses": dict(Counter(row["status"] for row in reference)),
        "cachedWorker": compare(path, "full-base", "full-product"),
        "freshWorker": compare(path, "fresh-baseline", "fresh-product"),
        "liveWorker": [dict(
            id=row["id"], leader=row["assessment"]["moves"][0]["category"],
            mistake=row["assessment"]["mistake"]["category"],
            evidence=row["assessment"]["moves"][0].get("promotionTactic"),
        ) for row in live],
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(report, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
