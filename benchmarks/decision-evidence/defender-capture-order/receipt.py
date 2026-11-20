"""Keep exact counterfactuals and scores without repeating the frozen histories."""

import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median

from freeze import read, write
from summary import key, san, summarize


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="mode", required=True)
    alternate_cases = commands.add_parser("alternate-cases")
    report = commands.add_parser("report")
    for name in ("app", "output"):
        alternate_cases.add_argument(name, type=Path)
    for name in ("app", "reference", "alternate", "repeat", "baseline", "output"):
        report.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.mode == "alternate-cases":
        write(args.output, [
            dict(row, candidate=row["proposal"]) for row in read(args.app)
            if row.get("proposal") and row["proposal"] != row.get("candidate")
        ])
        raise SystemExit
    app, recorded, alternate, repeated, baseline = map(read,
        (args.app, args.reference, args.alternate, args.repeat, args.baseline))
    result = summarize(app, recorded, baseline)
    candidate_refs = {(row["id"], key(row["candidate"])): row for row in [*recorded, *alternate]}
    separate_reviews = []
    for row in app:
        if attempt := row.get("attempt"):
            reference = candidate_refs[row["id"], key(row["proposal"])]
            separate_reviews.append(dict(id=row["id"], group=row["group"], app=attempt["label"],
                reference=reference["label"], exactProposal=key(row["proposal"]),
                originalReference=bool(row["candidate"] == row["proposal"]),
                referenceLines=san(row, reference),
                repeatedLines=san(row, reference["repeated"]) if reference.get("repeated") else None))
    result["appCandidateReviews"] = separate_reviews
    result["appCallsByReviewedStatus"] = dict(Counter(row["reference"]
        for row in separate_reviews if row["app"] == "guard-causal"))
    result["referenceOutcomes"] = [
        dict(id=row["id"], label=row["label"], gapCp=row.get("gap"), defender=row.get("guardRole"))
        for row in recorded
    ]
    result["largerReplay"] = dict(
        nodesPerSearch=2_400_000,
        medianMs=median(row["ms"] for row in repeated),
        decisions=[dict(id=row["id"], repeated=row["proof"]["label"]=="guard-causal"
                        and row["rootClose"] and row["agreedRole"], timingMs=row["ms"]) for row in repeated],
    )
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(result,out,indent=2,ensure_ascii=False)
        out.write("\n")
