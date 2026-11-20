"""Score the three independent questions and exact target availability."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "current-classifier-audit"))
from classical_score import AXES, SCOPES, detection, exact_index, mixed, prediction


def read(path):
    return json.loads(path.read_bytes())


def by_scope(report, scope, played):
    if scope == "move":
        available = report.get("moves", []) + ([report["playedMoveAssessment"]] if report.get("playedMoveAssessment") else [])
        return next((move for move in available if move["moveUci"] == played), None)
    return report.get(scope)


def calculate(cases, references, originals, workers):
    result = {}
    output = []
    for case in cases:
        key = case["id"]
        played = case["playedMoveUci"]
        reference = references[key]
        if played != reference["uci"]:
            raise ValueError(f"Exact move changed on {key}")
        scores = {}
        for scope in SCOPES:
            original = originals[f"{key}#{scope}"]
            classifier = {"original": dict(
                tactical=original.get("tactical"), positional=original.get("positional"),
                mixed=None, motifs=original.get("motifs", []),
            )}
            for version, records in workers.items():
                report = records[key]["report"] or {}
                evidence = by_scope(report, scope, played)
                classifier[version] = prediction(evidence, scope)
            scores[scope] = classifier
        output.append(dict(id=key, split=case["split"], scores=scores))
    for split in sorted({row["split"] for row in output}):
        rows = [row for row in output if row["split"] == split]
        result[split] = dict(cases=len(rows), scopes={})
        for scope in SCOPES:
            scoped = {}
            for arm in ("original", *workers):
                evaluations = [row["scores"][scope][arm] for row in rows]
                refs = [references[row["id"]][scope] for row in rows]
                scoped[arm] = dict(
                    categories=dict(Counter(value.get("category") for value in evaluations)) if arm != "original" else None,
                    axes={axis: detection(
                        [mixed(ref) if axis == "mixed" else ref[axis] for ref in refs],
                        [prediction[axis] for prediction in evaluations],
                    ) for axis in AXES if arm != "original" or axis == "tactical" or
                    (axis == "positional" and scope == "mistake")},
                    namedMotifs={
                        motif: detection([ref.get("motifs", {}).get(motif) for ref in refs],
                                         [motif in decision["motifs"] for decision in evaluations])
                        for motif in sorted({tag for ref in refs for tag in ref.get("motifs", {})})
                    } if scope == "move" else {},
                )
            result[split]["scopes"][scope] = scoped
    return dict(cohorts=result, cases=output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("original", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--workers", nargs="+", required=True, help="Revision=report.json")
    args = parser.parse_args()
    cases = read(args.frames)
    refs = read(args.reference)
    app_hash = sha256(args.frames.read_bytes()).hexdigest()
    assert refs["appFrameSha256"] == app_hash
    rows, labels = exact_index(cases), exact_index(refs["cases"])
    assert rows.keys() == labels.keys()
    originals = exact_index(read(args.original))
    workers = {}
    for item in args.workers:
        name, file = item.split("=", 1)
        workers[name] = exact_index(read(Path(file)))
        assert workers[name].keys() == rows.keys()
    scores = calculate(cases, labels, originals, workers)
    scores["appFrameSha256"] = app_hash
    scores["referenceSha256"] = sha256(args.reference.read_bytes()).hexdigest()
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(scores, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
