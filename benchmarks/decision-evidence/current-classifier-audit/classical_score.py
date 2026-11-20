"""Compare all three saved decision scopes against the sealed classical reference."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import random
import statistics

from score import detection, mixed, supported


SCOPES = ("position", "move", "mistake")
AXES = ("tactical", "positional", "mixed")
ALLOWED_INPUT = ("fen", "history", "candidates", "replyProbes", "playedMoveUci", "comparisonCandidates")


def read(path):
    return json.loads(path.read_bytes())


def write(path, data):
    with path.open("x", encoding="utf8", newline="\n") as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
        out.write("\n")


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def exact_index(rows):
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("Duplicate case in a replay.")
    return by_id


def checked_inputs(frame_path, reference_path):
    reference = read(reference_path)
    if reference["engineFrameSha256"]["app"] != digest(frame_path):
        raise ValueError("App-budget frames differ from the ones used for review.")
    cases = read(frame_path)
    reviewed = exact_index(reference["cases"])
    if set(exact_index(cases)) != set(reviewed):
        raise ValueError("The case set differs from the reviewed games.")
    for row in cases:
        labels = reviewed[row["id"]]
        if row["playedMoveUci"] != labels["mistake"]["uci"] or row["candidates"][0]["pvUci"][0] != labels["move"]["uci"]:
            raise ValueError(f"Misaligned exact choice: {row['id']}")
        for scope in SCOPES:
            if not labels[scope]["note"] or any(type(labels[scope][axis]) not in (type(None), bool) for axis in AXES[:2]):
                raise ValueError(f"Invalid reference: {row['id']} {scope}")
    return cases, reviewed


def prepare(cases, directory):
    inputs = [{key: row[key] for key in ("id", *ALLOWED_INPUT) if key in row} for row in cases]
    write(directory / "classical-replay-input.json", inputs)
    legacy = []
    for row in inputs:
        root = {key: row[key] for key in ("fen", "history", "candidates")}
        legacy.append(dict(root, id=row["id"] + "#root", label={}))
        legacy.append(dict(row, id=row["id"] + "#played", label={}))
    write(directory / "classical-legacy-input.json", legacy)


def assessment(report, scope, move):
    if scope == "move":
        return next((row for row in report.get("moves", []) if row["moveUci"] == move), None)
    return report.get(scope)


def prediction(value, scope):
    value = value or {}
    axes = supported(value)
    motifs = set()
    if scope == "move" and axes["tactical"]:
        motifs.update(item["id"] for item in value.get("verifiedMotifs", []) if item["ply"] == 1)
        motifs.update(item["mechanism"] for item in value.get("mechanisms", [])
                      if item["rootMoveInvolved"] and item["mechanismPly"] == 1)
        motifs.update(item["mechanism"] for item in value.get("localProofs", []))
    return dict(axes, mixed=axes["tactical"] and axes["positional"], motifs=sorted(motifs),
                category=value.get("category", "unavailable"))


def bootstrap(reference, predictions, groups):
    counts = defaultdict(lambda: [0, 0, 0])
    for label, decision, group in zip(reference, predictions, groups, strict=True):
        if label is None:
            continue
        counts[group][0] += label and decision
        counts[group][1] += label
        counts[group][2] += decision
    samples = list(set(groups))
    samples.sort()
    rng = random.Random(20261120)
    recall, precision = [], []
    for _ in range(2000):
        trial = [counts[group] for group in rng.choices(samples, k=len(samples))]
        tp, positives, calls = map(sum, zip(*trial, strict=True))
        if positives:
            recall.append(tp / positives)
        if calls:
            precision.append(tp / calls)

    def interval(values):
        if len(values) < 100:
            return None
        values = sorted(values)
        return [values[int((len(values) - 1) * q)] for q in (0.025, 0.975)]

    return dict(recall95=interval(recall), precision95=interval(precision),
                recallDraws=len(recall), precisionDraws=len(precision))


def cohort(samples, scope, arms, *, with_bootstrap=False):
    result = {}
    references = [row["reference"] for row in samples]
    groups = [row["group"] for row in samples]
    for method in arms:
        axes = {}
        for axis in AXES:
            if method == "original" and (axis == "mixed" or (axis == "positional" and scope != "mistake")):
                axes[axis] = None
                continue
            labels = [mixed(ref) if axis == "mixed" else ref[axis] for ref in references]
            predicted = [row["classifiers"][method][axis] for row in samples]
            axes[axis] = detection(labels, predicted)
            if with_bootstrap:
                axes[axis]["eventBootstrap"] = bootstrap(labels, predicted, groups)
        result[method] = axes
    return result


def scores(cases, refs, original, workers):
    analyses = {}
    base = exact_index(original)
    worlds = {version: exact_index(rows) for version, rows in workers.items()}
    if any(set(rows) != set(refs) for rows in worlds.values()) or set(base) != {
        key + "#" + target for key in refs for target in ("root", "played")
    }:
        raise ValueError("Replay results do not cover every frozen request.")
    for scope in SCOPES:
        today = []
        for row in cases:
            identity = row["id"]
            ref = refs[identity][scope]
            old = base[identity + ("#played" if scope == "mistake" else "#root")]
            methods = {"original": dict(tactical=old["tactical"], positional=old.get("positional"),
                                        mixed=None, motifs=old.get("motifs", []), category=old.get("category"))}
            for key, results in worlds.items():
                report = results[identity]["report"] or {}
                value = assessment(report, scope, refs[identity]["move"]["uci"])
                methods[key] = prediction(value, scope)
            today.append(dict(id=identity, group=row["group"], rating=row["ratingBand"], phase=row["phase"],
                              reference=ref, classifiers=methods))
        arms = today[0]["classifiers"].keys()
        motifs = sorted({key for item in today for key in item["reference"].get("motifs", {})})
        analyses[scope] = dict(
            cases=len(today),
            overall=cohort(today, scope, arms, with_bootstrap=True),
            byRating={band: cohort([item for item in today if item["rating"] == band], scope, arms)
                      for band in sorted({item["rating"] for item in today})},
            byPlyWindow={phase: cohort([item for item in today if item["phase"] == phase], scope, arms)
                         for phase in sorted({item["phase"] for item in today})},
            categories={arm: dict(Counter(item["classifiers"][arm]["category"] for item in today))
                        for arm in arms if arm != "original"},
            reviewedRootMotifs={motif: {arm: detection(
                [item["reference"].get("motifs", {}).get(motif) for item in today],
                [motif in item["classifiers"][arm]["motifs"] for item in today],
            ) for arm in arms} for motif in motifs},
            mixedPositiveCases=[{key: item[key] for key in ("id", "group", "classifiers")}
                                for item in today if mixed(item["reference"]) is True],
        )
    return analyses


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--score", type=Path, help="Score matched replays instead of preparing them")
    args = parser.parse_args()
    cases, reviewed = checked_inputs(args.app, args.reference)
    if not args.score:
        prepare(cases, args.directory)
        return
    original = read(args.directory / "classical-original.json")
    workers = {version: read(args.directory / f"classical-{version}.json") for version in ("v47", "v57")}
    result = scores(cases, reviewed, original, workers)
    write(args.score, dict(
        references=dict(path=args.reference.name, sha256=digest(args.reference), appFrameSha256=digest(args.app)),
        versions=dict(original="a4428e35 with the original recorded causal patch", v47="ae4bf1fc", v57="27580772"),
        groups=len({row["group"] for row in cases}),
        review="Single engine-assisted reviewer, blinded to all classifier output before sealing.",
        runtime=dict(
            originalRootMedianMs=statistics.median(row["ms"] for row in original if row["id"].endswith("#root")),
            originalMistakeMedianMs=statistics.median(row["ms"] for row in original if row["id"].endswith("#played")),
            **{version + "AllScopesMedianMs": statistics.median(row["ms"] for row in rows) for version, rows in workers.items()},
        ),
        results=result,
    ))


if __name__ == "__main__":
    main()
