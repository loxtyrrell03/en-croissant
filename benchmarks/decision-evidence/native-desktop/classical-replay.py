"""Prepare a matched original-classifier replay of the live classical inputs."""

import argparse
from collections import Counter
from hashlib import sha256
from pathlib import Path
from statistics import median
import sys

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "current-classifier-audit"))
from classical_score import assessment, cohort, detection, exact_index, prediction, read, write


def bind(capture, selection, partial):
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
        board = chess.Board(item["fen"])
        if ((row["id"], evidence["fen"], row["report"]["fen"]) !=
                (item["id"], item["fen"], item["fen"]) or
                board.parse_uci(evidence["playedMoveUci"]) != board.parse_uci(item["playedMoveUci"])):
            raise ValueError(f"Native evidence refers to a different board for {item['id']}")
        confirmed[item["id"]] = row
    if not confirmed or (len(confirmed) != len(sample) and not partial):
        raise ValueError(f"Native audit coverage is {len(confirmed)}/{len(sample)}")
    missing = [row["id"] for row in sample if row["id"] not in confirmed]
    return native, [row for row in sample if row["id"] in confirmed], confirmed, missing


def replays(cases, refs):
    old = []
    for identity, case in cases.items():
        frame = case["input"]
        common = {key: frame[key] for key in ("fen", "history") if key in frame}
        candidates = frame["candidates"]
        old.append(dict(common, id=identity + "#root", candidates=candidates, label={}))
        played = dict(frame, id=identity + "#played", label={})
        if not played.get("comparisonCandidates"):
            played.pop("comparisonCandidates", None)
        old.append(played)
        board = chess.Board(frame["fen"])
        target = board.parse_uci(refs[identity]["move"]["uci"])
        exact = next((line for line in [*candidates, *frame.get("comparisonCandidates", [])]
                      if board.parse_uci(line["pvUci"][0]) == target), None)
        if exact:
            old.append(dict(common, id=identity + "#move", candidates=[exact], label={}))
    return old


def shown_assessment(report, scope, target, board):
    if scope != "move":
        return assessment(report, scope, target)
    move = board.parse_uci(target)
    return next((choice for choice in [*report.get("moves", []), report.get("playedMoveAssessment")]
                 if choice and board.parse_uci(choice["moveUci"]) == move), None)


def score(sample, refs, native, baseline, fixed):
    original = exact_index(baseline)
    fixed = {row["id"].split("#")[-1]: row["report"] for row in fixed
             if "#" not in row["id"] or row["id"].startswith("classical#")}
    if set(original) != {row["id"] for row in replays(native, refs)} or not set(native) <= set(fixed):
        raise ValueError("The original or fixed-budget replay is missing its matched inputs")
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
            board = chess.Board(case["fen"])
            live_choice = shown_assessment(warm, scope, target, board)
            cached_choice = shown_assessment(fixed[identity] or {}, scope, target, board)
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
        if scope == "move":
            motifs = sorted({tag for row in decisions for tag in row["reference"].get("motifs", {})})
            result[scope]["reviewedRootMotifs"] = {
                motif: {
                    arm: detection(
                        [row["reference"].get("motifs", {}).get(motif) for row in decisions],
                        [motif in row["classifiers"][arm]["motifs"] for row in decisions],
                    ) for arm in decisions[0]["classifiers"]
                } for motif in motifs
            }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("selection", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--score", nargs=2, type=Path, metavar=("ORIGINAL_REPLAY", "FIXED_BUDGET_REPLAY"))
    parser.add_argument("--partial", action="store_true", help="Record missing live cases and score available matched cases")
    args = parser.parse_args()
    receipt, sample, native, missing = bind(args.capture, args.selection, args.partial)
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
                  cases=len(times), missing=missing,
                  seconds=dict(median=round(median(times), 2), maximum=round(max(times), 2)),
                  workers=dict(Counter(case["passes"] for case in native.values())),
                  results=result)
    write(args.output, output)


if __name__ == "__main__":
    main()
