"""Compare proof coverage, preserved verdicts and the avoided search cost."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

from sample import read
from verify import verify


def keyed(path):
    data = read(path)
    result = {row["id"]: row for row in data}
    if len(result) != len(data):
        raise ValueError(f"Duplicate case in {path}")
    return result


def consequence(row):
    return (((row.get("report") or {}).get("mistake") or {}).get("mateConsequence") or {})


def proved(row):
    choice = consequence(row)
    return choice.get("kind") == "allowed" and choice.get("mateIn") == 2


def compare_classical(raw, root, arms, worker_files):
    geometry = defaultdict(Counter)
    outcomes = defaultdict(Counter)
    examples = []
    positions = keyed(raw)
    for case_id, row in keyed(root / arms).items():
        title = positions[case_id]["reference"]["kind"]
        counts = geometry[title]
        counts["cases"] += 1
        for method in ("nominated", "checking", "all"):
            counts[method] += bool(row[method])
        if title == "allowed-two" and not row["all"]:
            counts["alreadyLosingByEngineMate"] += (positions[case_id]["candidates"][0]["mate"] or 0) < 0
    for label, filename in worker_files.items():
        for case_id, row in keyed(root / filename).items():
            question = positions[case_id]
            title = question["reference"]["kind"]
            outcomes[label][title] += proved(row)
            if label == "shortCandidate" and consequence(row).get("proof") == "legal":
                examples.append(dict(id=case_id, event=question["event"],
                    priorNodes=question["minimumPlayedNodes"],
                    **verify(question, consequence(row))))
    proof_runtime = [row["ms"] for row in keyed(root / arms).values() if "ms" in row]
    return dict(engineSha256=sha256(raw.read_bytes()).hexdigest(), proofCounts=geometry,
                workflow=outcomes, examples=examples,
                minimumNodesForSuccessfulProofs=sum(row["priorNodes"] for row in examples),
                medianMsThreeProofArms=round(median(proof_runtime), 3))


def compare_unchanged(original, candidate, raw):
    before, after = keyed(original), keyed(candidate)
    rows = keyed(raw)
    assert before.keys() == after.keys() == rows.keys()
    stats = Counter()
    differences = []
    for case_id, entry in before.items():
        old, new = entry["report"], after[case_id]["report"]
        assert bool(old) == bool(new)
        if not old:
            continue
        stats["valid"] += 1
        for scope in ("position", "moves", "mistake", "mistakeStatus"):
            stats[scope] += old[scope] != new[scope]
        if old["mistake"] != new["mistake"] and consequence(after[case_id]).get("proof") == "legal":
            differences.append(dict(id=case_id, **verify(rows[case_id], consequence(after[case_id]))))
    return dict(changes=stats, newProofs=differences,
                medianMs=[round(median(x["ms"] for x in d.values() if x["report"]), 2)
                          for d in (before, after)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("runs", "archive", "previous", "output"):
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    root, archive, previous = args.runs, args.archive, args.previous
    answers = {}
    configurations = {
        "development": ("development-engine.json", "development-proofs.json",
                        {"baseline": "development-full-base.json"}),
        "holdout": ("holdout-engine.json", "holdout-proofs-verified.json",
                    {"fullBaseline":"holdout-full-base.json", "shortBaseline":"holdout-root-base-final.json",
                     "fullCandidate":"holdout-full-new-verified.json", "shortCandidate":"holdout-root-new-verified.json"}),
        "quietPuzzles": ("quiet-recovered-engine.json", "quiet-recovered-proofs-verified.json",
                         {"fullBaseline":"quiet-full-base.json", "shortCandidate":"quiet-root-new-verified.json"}),
    }
    for name, (raw, proof, outputs) in configurations.items():
        answers[name] = compare_classical(root / raw, root, proof, outputs)
    answers["sampling"] = {name:read(root/f"{name}-manifest.json") for name in
                           ("development","holdout","quiet-recovered")}
    for name in ("development", "holdout"):
        manifest = answers["sampling"][name]
        manifest["sources"] = {Path(path).resolve().relative_to(archive.parent.resolve()).as_posix(): meta
                               for path, meta in manifest["sources"].items()}
    answers["archive"] = compare_unchanged(previous / "archive-next.json",
                         root / "archive-full-verified.json", archive/"inputs.json")
    answers["quietThreats"] = compare_unchanged(previous / "holdout-next.json",
                            root / "quiet-threat-compat.json", previous/"holdout-engine.json")
    with args.output.open("x",encoding="utf-8") as file:
        json.dump(answers,file,indent=2)
        file.write("\n")


if __name__ == "__main__":
    main()
