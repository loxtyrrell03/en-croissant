"""Prepare a matched original-classifier replay of the live classical inputs."""

import argparse
from collections import Counter
from hashlib import sha256
from pathlib import Path
from statistics import median
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "current-classifier-audit"))
from classical_score import assessment, cohort, exact_index, prediction, read, write


def bind(capture, selection):
    native = read(capture)
    if sha256(selection.read_bytes()).hexdigest() != native["sampleSha256"]:
        raise ValueError("Native receipt does not match the frozen sample")
    sample = read(selection)
    confirmed = {}
    for item in sample:
        row = native["scenarios"].get("Classical Audit " + item["id"])
        if not row or not row["passed"]:
            continue
        evidence = row["input"]
        if (row["id"], evidence["fen"], evidence["playedMoveUci"], row["report"]["fen"]) != (
                item["id"], item["fen"], item["playedMoveUci"], item["fen"]):
            raise ValueError(f"Native evidence refers to a different board for {item['id']}")
        confirmed[item["id"]] = row
    if len(confirmed) != len(sample):
        raise ValueError(f"Native audit coverage is {len(confirmed)}/{len(sample)}")
    return native, sample, confirmed


def replays(cases, refs):
    old = []
    for identity, case in cases.items():
        frame = case["input"]
        common = {key: frame[key] for key in ("fen", "history") if key in frame}
        candidates = frame["candidates"]
        old.append(dict(common, id=identity + "#root", candidates=candidates, label={}))
        old.append(dict(frame, id=identity + "#played", label={}))
        target = refs[identity]["move"]["uci"]
        exact = next((line for line in [*candidates, *frame.get("comparisonCandidates", [])]
                      if line["pvUci"][0] == target), None)
        if exact:
            old.append(dict(common, id=identity + "#move", candidates=[exact], label={}))
    return old


def score(sample, refs, native, baseline, fixed):
    original = exact_index(baseline)
    fixed = {row["id"].split("#")[-1]: row["report"] for row in fixed
             if "#" not in row["id"] or row["id"].startswith("classical#")}
    result = {}
    for scope in ("position", "move", "mistake"):
        decisions = []
        changed = []
        available = Counter()
        for case in sample:
            identity = case["id"]
            ref = refs[identity][scope]
            old = original.get(identity + "#" + {"position": "root", "move": "move", "mistake": "played"}[scope])
            target = refs[identity]["move"]["uci"]
            if old:
                available["original"] += 1
            warm = native[identity]["report"]
            live_choice = assessment(warm, scope, target)
            if scope == "move" and live_choice is None:
                shown = warm.get("playedMoveAssessment")
                if shown and shown["moveUci"] == target:
                    live_choice = shown
            cached_choice = assessment(fixed[identity] or {}, scope, target)
            if scope == "move" and cached_choice is None:
                nearby = (fixed[identity] or {}).get("playedMoveAssessment")
                if nearby and nearby["moveUci"] == target:
                    cached_choice = nearby
            for name, choice in (("native", live_choice), ("fixed", cached_choice)):
                if choice:
                    available[name] += 1
            classifiers = dict(
                original=dict(tactical=bool(old and old["tactical"]), positional=bool(old and old.get("positional")),
                              mixed=False, motifs=(old or {}).get("motifs", [])),
                native=prediction(live_choice, scope), fixed=prediction(cached_choice, scope),
            )
            if classifiers["native"]["category"] != classifiers["fixed"]["category"]:
                changed.append(dict(id=identity, reference={axis: ref[axis] for axis in ("tactical", "positional")},
                                    fixed=classifiers["fixed"]["category"], native=classifiers["native"]["category"]))
            decisions.append(dict(reference=ref, group=case["group"], classifiers=classifiers))
        result[scope] = dict(available=dict(available),
                             measurements=cohort(decisions, scope, tuple(decisions[0]["classifiers"]),
                                                 with_bootstrap=True),
                             changed=changed)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("selection", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--score", nargs=2, type=Path, metavar=("ORIGINAL_REPLAY", "FIXED_BUDGET_REPLAY"))
    args = parser.parse_args()
    receipt, sample, native = bind(args.capture, args.selection)
    reference = read(args.reference)
    if reference["sampleSha256"] != receipt["sampleSha256"]:
        raise ValueError("Review does not refer to this frozen benchmark")
    refs = exact_index(reference["cases"])
    if not args.score:
        return write(args.output, replays(native, refs))
    result = score(sample, refs, native, *(read(path) for path in args.score))
    times = [case["analysisSeconds"] for case in native.values()]
    output = dict(revision=receipt["revision"], sampleSha256=receipt["sampleSha256"],
                  referenceSha256=sha256(args.reference.read_bytes()).hexdigest(),
                  cases=len(times), seconds=dict(median=round(median(times), 2), maximum=round(max(times), 2)),
                  workers=dict(Counter(case["passes"] for case in native.values())),
                  results=result)
    write(args.output, output)


if __name__ == "__main__":
    main()
