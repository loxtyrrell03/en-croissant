"""Compare two replays on the same frozen reference or archive."""
import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent


def load(path):
    return json.loads(Path(path).read_bytes())


def score_motifs(results, references, adjudications):
    counts = Counter()
    for result, ref in zip(results, references, strict=True):
        if result["id"] != ref["id"]:
            raise ValueError(f'Replay mismatch at {ref["id"]}')
        corrections = adjudications.get(ref["id"], {})
        root_motifs = {m["id"] for m in result["engine"] if m["ply"] == 1}
        for motif, original in ref["labels"].items():
            label = corrections.get(motif, original)
            if label is None:
                outcome = "unknown"
            elif motif in root_motifs:
                outcome = "tp" if label else "fp"
            else:
                outcome = "fn" if label else "tn"
            counts[motif, outcome] += 1
    return {
        motif: {k: counts[motif, k] for k in ("tp", "fp", "fn", "tn", "unknown")}
        for motif in ("deflection", "clearance")
    }


def score_archive(before, after):
    counts = Counter()
    for old, new in zip(before, after, strict=True):
        if old["id"] != new["id"]:
            raise ValueError(f'Replay mismatch at {old["id"]}')
        counts["requests"] += 1
        counts["validBefore"] += old["report"] is not None
        counts["validAfter"] += new["report"] is not None
        counts["changedDecisions"] += old["report"] != new["report"]
        counts["changedLiveScans"] += old["motifs"] != new["motifs"]
        counts.update(
            motif["id"]
            for variation in new["motifs"]
            for motif in variation["motifs"]
            if "lineThroughPly" in motif
        )
    return dict(counts)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("before")
    args.add_argument("after")
    args.add_argument("--archive", action="store_true")
    options = args.parse_args()
    arms = {"before": load(options.before), "after": load(options.after)}
    if options.archive:
        scores = {"archive": score_archive(**arms)}
    else:
        ref = load(HERE / "reference.json")
        corrections = load(HERE / "adjudications.json")
        scores = {
            "blindReference": {arm: score_motifs(rows, ref, {}) for arm, rows in arms.items()},
            "afterSeparateAdjudication": {
                arm: score_motifs(rows, ref, corrections) for arm, rows in arms.items()
            },
        }
    scores["medianMs"] = {
        arm: round(median(row["ms"] for row in rows), 2) for arm, rows in arms.items()
    }
    print(json.dumps(scores, indent=2))


if __name__ == "__main__":
    main()
