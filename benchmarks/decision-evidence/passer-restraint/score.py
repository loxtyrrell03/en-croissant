"""Score the held-pawn alternatives, the verified check, and the unchanged worker."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess

from verify import read


def keyed(path):
    rows = read(path)
    data = {row["id"]: row for row in rows}
    if len(data) != len(rows):
        raise ValueError(f"Duplicate game-case identity in {path}")
    return data


def value(line):
    mate = line.get("mate")
    if mate:
        return 30_000 if mate > 0 else -30_000
    return line.get("cp")


def axis_counts(counts, kind, expected, supported):
    if expected is None:
        counts[kind]["unknown"] += 1
    elif expected:
        counts[kind]["tp" if supported else "fn"] += 1
    else:
        counts[kind]["fp" if supported else "tn"] += 1


def equivalent_support(old, evidence):
    tactical = (old.get("tactical") or {}).get("support") == "supported"
    positional = (old.get("positional") or {}).get("support") == "supported"
    if evidence:
        positional = True
        tactical |= bool(evidence["episode"])
    return dict(tactical=tactical, positional=positional, mixed=tactical and positional)


def record_controls(defence):
    return dict(
        prefix=defence["prefix"],
        captureUci=defence["captureUci"],
        estimateCp=(defence["selected"][0].get("cp") if defence["selected"] else None),
        mate=(defence["selected"][0].get("mate") if defence["selected"] else None),
        unrestrictedCp=(defence["alternatives"][0].get("cp") if defence["alternatives"] else None),
        unrestrictedMate=(defence["alternatives"][0].get("mate") if defence["alternatives"] else None),
    )


def confirm(baseline, nomination, controls):
    best, played = baseline["comparisonCandidates"]
    expected = {tuple(check["prefix"]): check for check in nomination["checks"]}
    if expected.keys() != controls.keys():
        raise ValueError(f"Missing or extra searched controls for {baseline['id']}")
    passed = True
    for prefix, search in controls.items():
        if any(search[key] != expected[prefix][key] for key in ("fen", "captureUci")):
            raise ValueError("Wrong-board defence")
        sampled = search["selected"]
        if not sampled:
            passed = False
            continue
        line = sampled[0]
        got = value(line)
        minimum = max(best["cp"] - 100, played["cp"] + 75)
        if (not line["pvUci"] or line["pvUci"][0] != search["captureUci"]
            or line["depth"] < 16 or got is None or got < minimum):
            passed = False
    return passed


def group(inputs, replay, worker, controls, deeper):
    raw = keyed(inputs)
    result = keyed(replay)
    baseline = keyed(worker)
    assert raw.keys() == result.keys() == baseline.keys()
    stats = defaultdict(Counter)
    axes = defaultdict(lambda: defaultdict(Counter))
    changed = []
    for case_id, frame in raw.items():
        cohort = frame["cohort"]
        out = result[case_id]
        old = (baseline[case_id]["report"] or {}).get("mistake") or {}
        stats[cohort]["requests"] += 1
        stats[cohort]["baselineMistakes"] += bool(old)
        stats[cohort]["attemptedPaired"] += "ms" in out
        for mode in ("advance", "lasting", "combined"):
            stats[cohort][mode] += bool(out.get(mode))
        accepted = None
        nomination = out.get("combined")
        if nomination and "#" not in case_id:
            checked = controls[case_id]
            if confirm(frame, nomination, checked):
                accepted = nomination
                stats[cohort]["confirmed"] += 1
            board = chess.Board(frame["fen"])
            after = equivalent_support(old, accepted)
            changed.append(dict(
                id=case_id, site=frame.get("site"), cohort=cohort, before=old.get("category"),
                proposed=after if accepted else None, tactical=nomination["episode"], positional=nomination["factor"],
                comparedScoresCp=[line["cp"] for line in frame["comparisonCandidates"]],
                testedLine=board.variation_san(map(chess.Move.from_uci, nomination["controlLineUci"])),
                playedLine=board.variation_san(map(chess.Move.from_uci, nomination["playedLineUci"])),
                betterLine=board.variation_san(map(chess.Move.from_uci, nomination["betterLineUci"])),
                controlResults=[record_controls(row) for row in checked.values()],
                repeatedAtDeeperBudget=bool(deeper.get(case_id, {}).get("combined")),
            ))
        label = frame.get("label") or {}
        if cohort == "archive" and label.get("scope") == "mistake-mechanism":
            t, p = label.get("tactical"), label.get("positional")
            mixed = False if False in (t, p) else True if t is True and p is True else None
            for arm, evidence in (("worker", None), ("confirmed", accepted)):
                observed = equivalent_support(old, evidence)
                for kind, expected in (("tactical", t), ("positional", p), ("mixed", mixed)):
                    axis_counts(axes[arm], kind, expected, observed[kind])
    return dict(byCohort=stats, archiveLabels=axes, examples=changed,
                medianMsForThreeArms=round(median(row["ms"] for row in result.values() if "ms" in row), 4),
                sha256=sha256(inputs.read_bytes()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("runs", "previous", "output"):
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    root, previous = args.runs, args.previous
    controls = defaultdict(dict)
    source = read(root / "pinned-controls.json")
    for row in source:
        controls[row["id"]][tuple(row["prefix"])] = row
    deeper = keyed(root / "positional-deeper-pinned.json")
    results = {}
    for name, inputs, replay, worker in (
        ("archive", previous / "inputs.json", "inputs-pinned.json", previous / "worker-v43.json"),
        ("transfer", root / "fresh-search.json", "fresh-search-pinned.json", root / "fresh-worker-base.json"),
        ("replication", root / "replicate-search.json", "replicate-search-pinned.json", root / "replicate-worker-base.json"),
    ):
        results[name] = group(inputs, root / replay, worker, controls, deeper)
    results["controlTimeSecondsMedian"] = round(median(row["seconds"] for row in source), 2)
    results["controlNodesPerSearch"] = 4_800_000
    results["frozenSampling"] = {}
    for name, inputs, manifest in (
        ("transfer", "fresh-candidates.json", "fresh-candidates-manifest.json"),
        ("replication", "replicate-frozen.json", "replicate-manifest.json"),
    ):
        results["frozenSampling"][name] = dict(**read(root / manifest),
            sha256=sha256((root / inputs).read_bytes()).hexdigest())
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
