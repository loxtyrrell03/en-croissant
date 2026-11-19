"""Score position character on already reviewed boards and measure search coverage."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from statistics import median

spec = importlib.util.spec_from_file_location(
    "decision_scores", Path(__file__).with_name("decision-evidence-score.py"),
)
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)

AXES = ("tactical", "positional", "mixed")
PROFILES = (
    "original", "equalWideTop3", "equalWide", "deepNarrow", "deepWideTop3", "deepWide",
    "deepWideCertificates",
)


def mixed(tactical, positional):
    if tactical is False or positional is False:
        return False
    return True if tactical is True and positional is True else None


def labels(case):
    t, p = case["tactical"], case["positional"]
    return t, p, mixed(t, p)


def predictions(report):
    position = report["position"] or {}
    t, p = (position.get(axis, {}).get("support") == "supported" for axis in AXES[:2])
    return t, p, t and p


def close_score(best, candidate, margin):
    return (
        best["cp"] is not None and candidate["cp"] is not None
        and best["cp"] - candidate["cp"] <= margin
    )


def summarize(roots, reports, cases):
    if not roots:
        raise ValueError("A reported cohort must have boards")
    truth = list(zip(*(labels(case) for case in cases)))
    more_lines = {}
    for profile in ["equalWide", "deepWide"]:
        frames = [row["frames"][profile]["lines"] for row in roots]
        more_lines[profile] = dict(
            additionalRoots=sum(max(0, len(frame) - 3) for frame in frames),
            withExtraWithin50Cp=sum(any(close_score(f[0], other, 50) for other in f[3:]) for f in frames),
            withExtraWithin100Cp=sum(any(close_score(f[0], other, 100) for other in f[3:]) for f in frames),
            recordedMoveAtRank4To8=sum(
                any(c["pvUci"][0] == root["playedMoveUci"] for c in frame[3:])
                for frame, root in zip(frames, roots)
            ),
        )
    scores = {}
    for profile in PROFILES:
        selected = [row["reports"][profile] for row in reports]
        prediction = list(zip(*(predictions(report) for report in selected)))
        scores[profile] = dict(
            axes={axis: metrics.detection(y, outputs) for axis, y, outputs in zip(AXES, truth, prediction)},
            medianDepth=median(row["rootAttempt"]["depth"] for row in selected),
            atLeastDepth18=sum(row["rootAttempt"]["depth"] >= 18 for row in selected),
            unavailableReports=sum(row["position"] is None for row in selected),
            rootNodes=sum(row["rootAttempt"]["requestedNodes"] for row in selected),
            replyNodes=sum(row["bestReplyNodes"] + row["nominatedReplyNodes"] for row in selected),
            medianClassifierMs=median(row["milliseconds"] for row in selected),
        )
    return dict(positions=len(roots), candidates=more_lines, scores=scores)


def human_nomination_summary(reports, cases, nominations):
    original = [predictions(row["reports"]["original"]) for row in reports]
    truth = list(zip(*(labels(case) for case in cases)))
    extra = [row for row in nominations if not row["inOriginal"]]
    result = dict(
        playedOutsideOriginal=len(extra),
        policyTop3=sum(row["policyWithin3"] for row in nominations),
        policyMedianMs=median(row["policyMs"] for row in nominations),
    )
    for arm, source in [("policy", "policy"), ("policyTop2", "policy"), ("wide", "wide")]:
        suggestions = [row["alternatives"][source] or {} for row in nominations]
        if arm == "policyTop2":
            suggestions = [
                item if item and item["policyRank"] <= 2 else {} for item in suggestions
            ]
        proved = [bool(item.get("evidence")) for item in suggestions]
        tactical = [previous[0] or proof for previous, proof in zip(original, proved)]
        mixed_axes = [t and previous[1] for previous, t in zip(original, tactical)]
        result[arm] = dict(
            nominated=sum(bool(item) for item in suggestions),
            recordedMoveMatched=sum(bool(item.get("recorded")) for item in suggestions),
            repliesSearched=sum(bool(item.get("searchedReply")) for item in suggestions),
            provedRefutations=sum(proved),
            freshProofs=sum(proof and not previous[0] for previous, proof in zip(original, proved)),
            addedTacticalDetection=metrics.detection(truth[0], tactical),
            addedMixedDetection=metrics.detection(truth[2], mixed_axes),
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", type=Path)
    parser.add_argument("reports", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reference", action="append", required=True, nargs=2,
                        metavar=("COHORT", "FILE"))
    parser.add_argument("--general", nargs="+", required=True)
    parser.add_argument("--human-proofs", type=Path)
    args = parser.parse_args()
    raw = args.roots.read_bytes()
    roots = json.loads(raw)
    reports = json.loads(args.reports.read_bytes())
    if reports["rootSha256"] != hashlib.sha256(raw).hexdigest():
        raise ValueError("Position reports refer to different root evidence")
    by_id = {row["id"]: row for row in reports["results"]}
    if len(by_id) != len(roots["rows"]) or len(by_id) != len(reports["results"]):
        raise ValueError("Root and classifier coverage differ")
    references = {}
    reference_hashes = {}
    for cohort, file in args.reference:
        ref_bytes = Path(file).read_bytes()
        cases = json.loads(ref_bytes)["cases"]
        if (
            cohort in references or any(case["scope"] != "position-character" for case in cases)
            or len({case["id"] for case in cases}) != len(cases)
        ):
            raise ValueError("Expected a distinct position-character reference per cohort")
        references[cohort] = {case["id"]: case for case in cases}
        reference_hashes[cohort] = hashlib.sha256(ref_bytes).hexdigest()
    if set(references) != set(roots["cohorts"]):
        raise ValueError("Reference cohort coverage differs from the search")
    for cohort, cases in references.items():
        expected = {row["id"] for row in roots["rows"] if row["cohort"] == cohort}
        if set(cases) != expected:
            raise ValueError(f"Reference board coverage differs in {cohort}")
    groups = {cohort: {cohort} for cohort in references}
    groups["general"] = set(args.general)
    if groups["general"] - references.keys():
        raise ValueError("Unknown general cohort")
    human = {}
    if args.human_proofs:
        proof_report = json.loads(args.human_proofs.read_bytes())
        human = {row["id"]: row for row in proof_report["results"]}
        if proof_report["rootSha256"] != reports["rootSha256"] or human.keys() != by_id.keys():
            raise ValueError("Human candidate proofs refer to different boards")
    results = {}
    for name, cohorts in groups.items():
        selected = [row for row in roots["rows"] if row["cohort"] in cohorts]
        matching_reports = [by_id[row["id"]] for row in selected]
        cases = [references[row["cohort"]][row["id"]] for row in selected]
        results[name] = summarize(selected, matching_reports, cases)
        if human:
            results[name]["humanNomination"] = human_nomination_summary(
                matching_reports, cases, [human[row["id"]] for row in selected],
            )
    receipt = dict(
        scope="Previously reviewed positions. Separate challenge results. Missing labels are unknown.",
        sourceSha256=reports["rootSha256"], referenceHashes=reference_hashes, results=results,
    )
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2)
    print(json.dumps({
        name: {
            profile: {axis: [counts["tp"], counts["fp"]] for axis, counts in result["axes"].items()}
            for profile, result in cohort["scores"].items()
        }
        for name, cohort in results.items()
    }))


if __name__ == "__main__":
    main()
