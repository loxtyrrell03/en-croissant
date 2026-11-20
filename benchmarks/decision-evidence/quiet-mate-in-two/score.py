"""Report the two proof methods and compare complete Decision Evidence reports."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
from statistics import median

from sample import read
from verify import verify


def keyed(path):
    rows = read(path)
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError(f"Duplicate case id in {path}")
    return result


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def has_tactics(report):
    return report["tactical"]["support"] == "supported"


def mate_two(move):
    threat = move.get("quietMateThreat") or {}
    return threat if threat.get("mateIn") == 2 else None


def score_proofs(raw, proofs):
    by_label = defaultdict(Counter)
    for case_id, row in raw.items():
        if not row.get("reference"):
            continue
        kind = row["reference"]["kind"]
        exact = next((item for item in proofs[case_id]["calls"]
                      if item["moveUci"] == row["gameMoveUci"]), {})
        bucket = by_label[kind]
        bucket["requests"] += 1
        for arm in ("searched", "legal"):
            bucket[arm] += bool(exact.get(arm))
        if kind == "new-mate-two" and not exact.get("legal"):
            focused = row.get("focused") or {}
            bucket["declinedBelowMinusOnePawn"] += focused.get("cp") is not None and focused["cp"] < -100
    return by_label


def score_worker(raw, first, second):
    assert raw.keys() == first.keys() == second.keys()
    group = defaultdict(Counter)
    evidence = []
    for case_id, row in raw.items():
        before, after = first[case_id]["report"], second[case_id]["report"]
        assert bool(before) == bool(after), case_id
        if before is None:
            continue
        kind = (row.get("reference") or {}).get("kind") or row.get("cohort") or "all"
        stats = group[kind]
        stats["valid"] += 1
        old, new = before["position"], after["position"]
        stats["positionTacticalBefore"] += has_tactics(old)
        stats["positionTacticalAfter"] += has_tactics(new)
        stats["addedPositionTactical"] += has_tactics(new) and not has_tactics(old)
        stats["addedPositionMixed"] += new["category"] == "mixed" and old["category"] != "mixed"
        stats["positionCategoryChanges"] += old["category"] != new["category"]
        stats["positionEvidenceChanges"] += old != new
        assert before["mistake"] == after["mistake"] and before["mistakeStatus"] == after["mistakeStatus"], case_id
        assert len(before["moves"]) == len(after["moves"]), case_id
        for prior, current in zip(before["moves"], after["moves"], strict=True):
            assert prior["moveUci"] == current["moveUci"], case_id
            if threat := mate_two(current):
                assert not mate_two(prior) and not has_tactics(prior) and has_tactics(current), case_id
                stats["newMoveProofs"] += 1
                stats["newProofsAtRecordedMove"] += current["moveUci"] == row.get("gameMoveUci")
                exact = verify(row, threat)
                evidence.append(dict(case=case_id, group=kind, event=row.get("event"),
                    moveUci=current["moveUci"], beforePosition=old["category"], afterPosition=new["category"],
                    afterMove=current["category"], moves=exact, explanation=threat["explanation"]))
    return dict(groups=group, witnesses=evidence,
                medianWorkerMs=dict(
                    baseline=round(median(item["ms"] for item in first.values() if item["report"]), 2),
                    candidate=round(median(item["ms"] for item in second.values() if item["report"]), 2),
                ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("runs", "previous", "output"):
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    directory, previous = args.runs, args.previous
    results = {}
    for group in ("development", "holdout", "replication"):
        original = directory / f"{group}.json"
        analysed = directory / f"{group}-engine.json"
        rows = keyed(analysed)
        proofs = keyed(directory / f"{group}-proofs.json")
        sampling = read(directory / f"{group}-manifest.json")
        sampling["sources"] = {
            Path(path).resolve().relative_to(previous.parent.resolve()).as_posix(): item
            for path, item in sampling["sources"].items()
        }
        results[group] = dict(
            frozenSha256=hash_file(original), engineInputSha256=hash_file(analysed),
            sampling=sampling,
            focused=score_proofs(rows, proofs),
            medianMsBothProofMethods=round(median(row["ms"] for row in proofs.values()), 2),
            worker=score_worker(rows, keyed(directory / f"{group}-base.json"),
                                keyed(directory / f"{group}-next.json")),
        )
    old_input = previous / "inputs.json"
    results["archive"] = dict(engineInputSha256=hash_file(old_input),
        worker=score_worker(keyed(old_input), keyed(previous / "worker-v43.json"),
                            keyed(directory / "archive-next.json")))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(results, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
