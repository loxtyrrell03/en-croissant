"""Compare the original and candidate decision workers after the reference is frozen."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

from readback import read, review


def index(rows):
    keys = {row["id"]: row for row in rows}
    if len(keys) != len(rows):
        raise ValueError("Duplicate case IDs in the replay")
    return keys


def moves(report):
    if not report:
        return {}
    return {line["moveUci"]: line for line in [*report["moves"], report.get("playedMoveAssessment")] if line}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    files = {name: args.lab / name for name in (
        "matched-input.json", "matched-before.json", "matched-candidate.json", "transfer-reference.json",
    )}
    inputs, before, after, _ = (index(read(source)) for source in files.values())
    if inputs.keys() != before.keys() or inputs.keys() != after.keys():
        raise ValueError("Workers did not receive matching cases")
    reference = read(args.reference)
    hashes = {name: sha256(source.read_bytes()).hexdigest() for name, source in files.items()}
    if hashes["transfer-reference.json"] != reference["referenceFrameSha256"]:
        raise ValueError("Reference engine frames differ from the frozen review")
    labels = {(f"transfer#{row['id']}", row["moveUci"]): row for row in reference["cases"]}
    counts, changes, score_only = Counter(), [], []
    for key, frame in inputs.items():
        cohort = key.split("#", 1)[0]
        counts[cohort] += 1
        old, new = before[key]["report"], after[key]["report"]
        if bool(old) != bool(new):
            raise ValueError(f"Report availability changed for {key}")
        if not old:
            continue
        old = {field: value for field, value in old.items() if field != "version"}
        new = {field: value for field, value in new.items() if field != "version"}
        if (old["mistake"], old["mistakeStatus"]) != (new["mistake"], new["mistakeStatus"]):
            raise ValueError(f"The played mistake changed for {key}")
        old_moves, new_moves = moves(old), moves(new)
        if cohort == "transfer":
            for candidate in review(frame)["candidates"]:
                item = old_moves[candidate["move"]]
                badges = item["verifiedMotifs"]
                if (candidate["nearQuiet"] and candidate["scoreCp"] >= 300 and
                        any(tag["label"] == "Hanging Pawn" for tag in badges)):
                    score_only.append(dict(id=key, move=candidate["move"], san=candidate["san"],
                                           corroborated=(key, candidate["move"]) in labels,
                                           alternatives=candidate["alternatives"]))
        if old == new:
            continue
        if old_moves.keys() != new_moves.keys():
            raise ValueError(f"The exact choices changed for {key}")
        changed_choices = []
        for move in old_moves:
            origin, updated = old_moves[move], new_moves[move]
            if origin == updated:
                continue
            explanation = updated.get("deferredPawnCapture")
            if (not explanation or origin["positional"] != updated["positional"] or
                    origin["evaluationCp"] != updated["evaluationCp"]):
                raise ValueError(f"The change is outside the deferred capture in {key}")
            changed_choices.append(dict(move=move, v65=origin["category"], v66=updated["category"],
                                        witness=explanation, independentlyCorroborated=(key, move) in labels))
        changes.append(dict(id=key, site=frame.get("site"), moves=changed_choices,
                            position=dict(v65=old["position"]["category"], v66=new["position"]["category"])))
    result = dict(inputs=hashes, referenceSha256=sha256(args.reference.read_bytes()).hexdigest(),
                  counts=dict(counts), compared=sum(counts.values()), reportsChanged=len(changes),
                  referenceDecisions=len(labels),
                  workerMedianMilliseconds=dict(v65=round(median(row["ms"] for row in before.values()), 2),
                                                v66=round(median(row["ms"] for row in after.values()), 2)),
                  additionalEngineQueries=0, scoreOnly=score_only, changes=changes)
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(result, out, indent=2)
        out.write("\n")
    print(result["compared"], result["reportsChanged"], len(score_only), flush=True)


if __name__ == "__main__":
    main()
