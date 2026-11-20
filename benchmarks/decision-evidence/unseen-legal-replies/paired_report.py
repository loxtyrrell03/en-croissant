"""Summarize the exploratory matched-reply replay against deeper evidence."""

import argparse
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from freeze import read, write
from summary import key, san

parser = argparse.ArgumentParser(description=__doc__)
for name in ("context", "references", "output"):
    parser.add_argument(name, type=Path)
args = parser.parse_args()
replay = read(args.context)
depth = {(item["id"], key(item["candidate"])): item for item in read(args.references)}
reported = []
for case in replay:
    if case["label"] != "guard-causal":
        continue
    reference = depth.get((case["id"], key(case["candidate"])))
    if not reference:
        raise ValueError(f"Missing independent evidence for {case['id']}")
    reported.append(dict(id=case["id"], site=case["site"], hypothesis=case["candidate"],
        label=reference["label"], referenceExact=reference["referenceExact"],
        matchedReply=[dict(cp=line["cp"], first=line["pvUci"][0]) for line in case["replyComparison"]],
        app=san(case, case["proof"]), deeper=san(case, reference)))
write(args.output, dict(
    attempted=len(replay), outcomes=Counter(row["label"] for row in replay),
    ordinaryScreened=sum(row["category"] == "ordinary" for row in replay),
    ordinaryCompared=sum(row["category"] == "ordinary" and "proof" in row for row in replay),
    fullComparisons=sum("proof" in row for row in replay),
    reservedNodes=sum(row["nodes"] for row in replay), calls=reported,
))
