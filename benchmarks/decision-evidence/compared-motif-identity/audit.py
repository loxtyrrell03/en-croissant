"""Score exact scopes, compare matcher outputs and explain missed mixed cases."""

import argparse
from collections import Counter, defaultdict
import importlib
import json
from pathlib import Path
from statistics import median
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts/benchmarks"))
evaluator = importlib.import_module("decision-evidence-evaluate")
from inputs import read, digest


def indexed(rows):
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate result identity")
    return result


def dimensions(assessment):
    result = {axis: assessment.get(axis, {}).get("support") == "supported"
              for axis in ("tactical", "positional")}
    return dict(result, mixed=result["tactical"] and result["positional"])


def mixed_truth(ref):
    return True if ref.get("tactical") is True and ref.get("positional") is True else (
        False if ref.get("tactical") is False or ref.get("positional") is False else None
    )


def scores(labels, predictions):
    return {axis: evaluator.metrics.detection(
        [mixed_truth(label) if axis == "mixed" else label[axis] for label in labels],
        [prediction[axis] for prediction in predictions],
    ) for axis in ("tactical", "positional", "mixed") if all(axis in prediction for prediction in predictions)}


def archive_audit(research, candidate):
    archive_file = research / "reply-coverage-audit/full-pair-input.json"
    rows = read(archive_file)
    original = indexed(read(research / "unified-audit/archive-original.json"))
    v33 = indexed(read(research / "unified-audit/threat-final-full-candidate.json"))
    v39 = indexed(read(research / "fork-defence-concession/archive-release.json"))
    groups = defaultdict(list)
    for row in rows:
        label = row.get("label")
        if not label:
            continue
        if row.get("playedMoveUci") and label["moveUci"] != row["playedMoveUci"]:
            raise ValueError("Recorded move differs from the labelled move")
        group = ("mistake" if row.get("playedMoveUci") else
                 "ordinaryPosition" if label.get("scope") == "position-character" else "otherPosition")
        groups[group].append(row)
    summary = {}
    for group, cases in groups.items():
        scope = "mistake" if group == "mistake" else "position"
        ids = [row["id"] for row in cases]
        labels = [row["label"] for row in cases]
        baselines = [{axis: original[key][axis] for axis in
                      (("tactical", "positional") if group == "mistake" else ("tactical",))} for key in ids]
        reports = {"v33": v33, "v39": v39}
        if group == "mistake":
            reports["roleSquares"] = candidate
        evaluated = {
            version: scores(labels, [dimensions((arm[key]["report"] or {}).get(scope) or {}) for key in ids])
            for version, arm in reports.items()
        }
        summary[group] = dict(cases=len(cases), original=scores(labels, baselines), **evaluated)
    return dict(scores=summary, inputsSha256=digest(archive_file))


def course_audit(research, lab, records, name):
    raw = read(lab / f"{name}.json")
    reference = read(research / f"{name}-reference-v13heldout.json")
    old_path = research / f"{name}-candidate-v33-audit.json"
    previous = read(old_path)
    expected = indexed(previous["results"])
    matches, mismatch = [], Counter()
    def line_key(line):
        return tuple(line.get(key) for key in ("fen", "cp", "mate", "depth", "pvUci", "lowerbound", "upperbound"))
    for row in raw:
        key = row["id"]
        if key not in expected:
            mismatch["outsidePriorSet"] += 1
            continue
        root_path = research / f"{name}-engine-v13heldout" / f"{key}.json"
        probe_path = research / f"{name}-probes-v13heldout" / f"{key}.json"
        roots, replies = read(root_path), read(probe_path)
        if (
            roots["identity"] != expected[key]["engineIdentity"] or
            replies["identity"] != expected[key]["probeIdentity"] or
            replies["identity"]["root_sha256"] != digest(root_path)
        ):
            raise ValueError("Old frame identity mismatch")
        if [line_key(line) for line in row["candidates"]] != [line_key(line) for line in roots["deep"]]:
            mismatch["differentRoot"] += 1
            continue
        if row["replyProbes"] != replies["replyProbes"]:
            mismatch["differentReplies"] += 1
            continue
        matches.append(key)
    usable = set(matches)
    exact = dict(reference, cases=[question for question in reference["cases"]
                                   if question["id"] in usable and question["scope"] == "move-justification"])
    old = [expected[key] for key in matches]
    newer = [dict(expected[key], assessment=records[key]["report"]) for key in matches]
    return dict(exactMatchedPositions=len(usable), labelledQuestions=len(exact["cases"]),
                sourceUnmatched=dict(mismatch), oldSourceSha256=digest(old_path),
                originalAndV33=evaluator.evaluate(exact, dict(results=old))["questions"],
                originalAndV39=evaluator.evaluate(exact, dict(results=newer))["questions"])


def depth_audit(research, baseline):
    reference_path = Path("benchmarks/decision-evidence/promotion-intermezzo/mixed-reference-reviewed.json")
    rows = read(reference_path)
    confirmed = {row["id"] for row in rows if row["audited"]["mixed"] is True}
    ground = indexed(read(research / "evidence-ceiling-v38/depth-current.json"))
    results = {}
    for arm in ("original", "pair", "replies", "both"):
        counts, axes = Counter(), Counter()
        for key in confirmed:
            name = key + "#" + arm
            row = baseline[name]
            predicted = (row["report"] or {}).get("mistake")
            old = (ground[name]["report"] or {}).get("mistake")
            if predicted != old:
                raise ValueError("Archived reply audit and current worker disagree on mistake")
            counts[predicted["category"] if predicted else "unavailable"] += 1
            replies = ground[name]["replies"]
            if replies["rootMatches"] and all((replies[side] or {}).get("corroborated") for side in ("best", "played")):
                axes["bothReplyFramesCorroborate"] += 1
            if not replies["rootMatches"]:
                axes["missingMatchedRoot"] += 1
        results[arm] = dict(categories=dict(counts), evidence=dict(axes))
    return dict(reviewed=len(rows), independentlyRecheckedMixed=len(confirmed), arms=results,
                referenceSha256=digest(reference_path))


def worker_comparison(lab):
    baseline, squares, origins = [indexed(read(lab / f"combined-{name}.json"))
                                  for name in ("record", "squares", "origins")]
    if set(baseline) != set(squares) or set(baseline) != set(origins):
        raise ValueError("Combined replay must use the same rows")
    publication = lab / "combined-release.json"
    released = indexed(read(publication)) if publication.exists() else {}
    if released and set(released) != set(baseline):
        raise ValueError("Integrated replay must cover every compared row")

    def content(row):
        report = row["report"]
        return {key: value for key, value in report.items() if key != "version"} if report else report

    result = {}
    for name in ("archive-mistakes", "reserve", "mixed-depth", "course", "independent"):
        ids = [row["id"] for row in read(lab / f"{name}.json")]
        before = [baseline[key] for key in ids]
        output = dict(cases=len(ids), baselineCalls=sum(len(row["pairs"]) for row in before),
                      baselineCasesWithCalls=sum(bool(row["pairs"]) for row in before), arms={})
        for label, arm in (("roleSquares", squares), ("originalPieces", origins)):
            changed = [key for key in ids if baseline[key]["report"] != arm[key]["report"]]
            output["arms"][label] = dict(
                reportChanges=changed,
                changedMatches=sum(pair["legacy"] != pair["result"] for key in ids for pair in arm[key]["pairs"]),
                medianMs=median(arm[key]["ms"] for key in ids if "ms" in arm[key]),
            )
        output["baselineMedianMs"] = median(row["ms"] for row in before if "ms" in row)
        if released:
            output["released"] = dict(
                reportChanges=[key for key in ids if content(baseline[key]) != content(released[key])],
                medianMs=median(released[key]["ms"] for key in ids if "ms" in released[key]),
            )
        result[name] = output
    return result, baseline, squares


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("research", type=Path)
    cli.add_argument("replay", type=Path)
    cli.add_argument("output", type=Path)
    args = cli.parse_args()
    comparisons, baseline, candidate = worker_comparison(args.replay)
    output = dict(worker=comparisons, archive=archive_audit(args.research, candidate),
                  depth=depth_audit(args.research, baseline))
    for name in ("course", "independent"):
        output[name] = course_audit(args.research, args.replay, baseline, name)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(output, stream, indent=2)


if __name__ == "__main__":
    main()
