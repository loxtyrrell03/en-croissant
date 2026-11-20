"""Compare exact cached decision reports for alternate-capture proof arms."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median
import sys


def index(path):
    data = json.loads(path.read_bytes())
    rows = {row["id"]: row for row in data}
    if len(rows) != len(data):
        raise ValueError(f"Duplicate replay IDs in {path}")
    return rows


def compare(before, after):
    if before.keys() != after.keys():
        raise ValueError("Comparison contains different games or positions")
    changes = Counter()
    verdicts = {}
    for key in before:
        old, new = before[key]["report"], after[key]["report"]
        if (old is None) != (new is None):
            raise ValueError(f"Report availability changed for {key}")
        if not old:
            continue
        for scope in ("position", "moves", "mistake", "mistakeStatus"):
            changes[scope] += old.get(scope) != new.get(scope)
        if old["mistake"] != new["mistake"]:
            verdicts[key] = [report["mistake"]["category"] for report in (old, new)]
    return {
        "requests": len(before),
        "validReports": sum(row["report"] is not None for row in before.values()),
        "changedByScope": changes,
        "changedMistakeVerdicts": verdicts,
        "medianWorkerMs": {
            name: round(median(row["ms"] for row in rows.values() if row["report"] is not None), 2)
            for name, rows in (("before", before), ("after", after))
        },
    }


def recorded_claims(reports):
    found = []
    for key, row in reports.items():
        mistake = (row["report"] or {}).get("mistake")
        if mistake and any("is an alternative reply" in s for s in mistake["tactical"]["reasons"]):
            found.append(key)
    return found


def main(lab, prior, output):
    base = index(lab / "transfer-base.json")
    final = index(lab / "transfer-product.json")
    fresh_source = lab / "fresh.json"
    fresh = index(fresh_source)
    counts = {
        name: {"all": compare(base, index(lab / f"transfer-{name}.json"))}
        for name in ("direct-only", "all-material", "product")
    }
    for label, include in (("fresh", fresh), ("prospective", base.keys() - fresh.keys())):
        counts["product"][label] = compare(
            {key: base[key] for key in include}, {key: final[key] for key in include},
        )
    archive_base = index(prior / "current-classifier-audit/archive-product.json")
    archive_candidate = index(lab / "archive-product.json")
    controls_base = index(lab / "controls-base.json")
    controls = index(lab / "controls-product.json")
    result = {
        "baseline": "b6eb8757",
        "candidate": "Decision Evidence v49 and mistake review adapter 179",
        "comparisons": counts,
        "archive": compare(archive_base, archive_candidate),
        "controls": compare(controls_base, controls),
        "alternateCaptureReports": {
            "archive": {
                "before": recorded_claims(archive_base), "after": recorded_claims(archive_candidate),
            },
            "fresh": {
                "before": recorded_claims({key: base[key] for key in fresh}),
                "after": recorded_claims({key: final[key] for key in fresh}),
            },
            "controls": {
                "before": recorded_claims(controls_base), "after": recorded_claims(controls),
            },
        },
        "inputs": {
            name: sha256(path.read_bytes()).hexdigest() for name, path in {
                "archive": prior / "reply-coverage-audit/full-pair-input.json",
                "fresh": fresh_source,
                "freshScored": lab / "fresh-scored.json",
                "combined": lab / "transfer.json",
                "controls": lab / "controls.json",
            }.items()
        },
        "freshPublicIds": list(fresh),
        "freshSourceManifest": json.loads((lab / "fresh-manifest.json").read_bytes()),
    }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
