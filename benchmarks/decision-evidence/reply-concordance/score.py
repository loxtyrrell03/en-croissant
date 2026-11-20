"""Compare the existing classifier and each reply-concordance prototype."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

from prepare import BENCHMARKS, read


def rows(path):
    items = read(path)
    by_id = {item["id"]: item for item in items}
    if len(by_id) != len(items):
        raise ValueError(f"Duplicate IDs in {path}")
    return by_id


def compare(before, after):
    if before.keys() != after.keys():
        raise ValueError("Unmatched decision IDs")
    changed = {}
    for key, original in before.items():
        old = original["report"]
        new = after[key]["report"]
        if old is None or new is None:
            if old != new:
                raise ValueError(f"Report availability changed for {key}")
            continue
        for scope in ("position", "moves", "mistakeStatus"):
            if old[scope] != new[scope]:
                raise ValueError(f"Unexpected {scope} change for {key}")
        if old["mistake"] != new["mistake"]:
            changed[key] = {
                "before": old["mistake"]["category"],
                "after": new["mistake"]["category"],
                **{axis: new["mistake"][axis]["reasons"] for axis in ("tactical", "positional")},
            }
    return {"requests": len(before), "changed": changed}


def alternate_counts(inputs, gap):
    counts = Counter()
    for row in inputs.values():
        matched = 0
        for line in row.get("comparisonCandidates") or ():
            if line["cp"] is None or len(line["pvUci"]) < 2:
                continue
            move, reply = line["pvUci"][:2]
            probe = next((p["lines"] for p in row.get("replyProbes", ()) if p["moveUci"] == move), [])
            if not probe or probe[0]["cp"] is None or probe[0]["depth"] < 16:
                continue
            for item in probe[1:]:
                if (
                    item["pvUci"][:1] == [reply]
                    and item["depth"] == probe[0]["depth"]
                    and item["cp"] is not None
                    and 0 <= probe[0]["cp"] - item["cp"] <= gap
                    and abs(line["cp"] + item["cp"]) <= 90
                ):
                    matched += 1
                    break
        counts[matched] += 1
    return {name: counts[index] for index, name in enumerate(("none", "one", "both"))}


def archival_review(archive, deeper):
    reference = read(BENCHMARKS / "promotion-intermezzo/mixed-reference-reviewed.json")
    verified = [row["id"] for row in reference if row["audited"]["mixed"] is True]
    tally = {}
    for name, item in (("archive", archive), ("deeperForcedPair", deeper)):
        classifications = {}
        for key in verified:
            report = item[key]["report"] or {}
            classifications[key] = (report.get("mistake") or {}).get("category", "missing")
        tally[name] = {"categoryCounts": Counter(classifications.values()), "byId": classifications}
    return {"originalMixedLabels": len(reference), "confirmedMixedLabels": len(verified), **tally}


def main(lab, prior, output):
    results = {
        "baselineRevision": "053ca262",
        "inputs": {},
    }
    requests = rows(lab / "matched.json")
    before = rows(lab / "baseline.json")
    results["matched"] = {
        "cohorts": Counter(key.split(":")[0] for key in requests),
        "eligibleAlternateCounts": {gap: alternate_counts(requests, gap) for gap in (35, 65)},
        "arms": {
            name: compare(before, rows(lab / f"{name}.json"))
            for name in ("both", "tight", "positional", "tactical", "matched-guarded")
        },
    }
    reserve = rows(lab / "reserve-base.json")
    results["freshReserve"] = {
        "eventFiles": read(lab / "reserve-manifest.json"),
        "eligibleAlternateCounts": alternate_counts(rows(lab / "reserve-scored.json"), 35),
        "arms": {name: compare(reserve, rows(lab / f"reserve-{name}.json")) for name in ("tight", "guarded")},
    }
    depth = rows(lab / "depth-base.json")
    results["depthCheck"] = {name: compare(depth, rows(lab / f"{name}.json")) for name in ("depth-both", "guarded")}
    results["reviewedMixed"] = archival_review(
        rows(prior / "alternate-capture-payoff/archive-product.json"),
        rows(lab / "deep-reports.json"),
    )
    for name in ("matched", "deep", "reserve", "reserve-scored", "depth-check"):
        results["inputs"][name] = sha256((lab / f"{name}.json").read_bytes()).hexdigest()
    with output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
