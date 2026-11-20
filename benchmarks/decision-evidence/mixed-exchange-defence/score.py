"""Score the named recapture mechanism against its frozen reference."""
import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent


def load(path):
    return json.loads(path.read_bytes())


def index(rows):
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate case identifiers")
    return result


def score(reference, nominations):
    unexpected = nominations.difference(reference)
    if unexpected:
        raise ValueError(f"Unexpected cases in replay {sorted(unexpected)}")
    table = {}
    for cohort in ("classical", "puzzles"):
        count = Counter()
        for case, row in reference.items():
            if row["cohort"] != cohort:
                continue
            status = row["status"]
            detected = case in nominations
            if status == "excluded":
                count["excluded"] += 1
                if detected:
                    count["excludedNominated"] += 1
            elif status == "uncertain":
                count["uncertain"] += 1
                if detected:
                    count["uncertainNominated"] += 1
            elif status == "yes":
                count["tp" if detected else "fn"] += 1
            elif status == "no":
                count["fp" if detected else "tn"] += 1
            else:
                raise ValueError(f"Unexpected reference label {status}")
        keys = ("tp", "fp", "fn", "tn", "uncertain", "uncertainNominated", "excluded", "excludedNominated")
        table[cohort] = {key: count[key] for key in keys}
    return table


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path)
    parser.add_argument("quick_replay", type=Path)
    options = parser.parse_args()
    references = index(load(HERE / "reference.json"))
    replay = index(load(options.replay))
    if replay.keys() != references.keys():
        raise ValueError("Mismatch between the reviewed sample and the replay")
    quick = set(index(load(options.quick_replay)))
    positive = [key for key, row in references.items() if row["status"] == "yes"]
    out = {
        "reference": len(references),
        "baselineStatus": dict(Counter(row["baselineStatus"] for row in replay.values())),
        "positiveCaseBaseline": {
            key: {
                "status": replay[key]["baselineStatus"],
                "category": (replay[key]["baseline"] or {}).get("category"),
            }
            for key in positive
        },
        "quick": score(references, quick),
        "controlled": score(references, {key for key, row in replay.items() if row["evidence"]}),
        "timingMs": {
            "baselineMedian": round(median(row["baselineMs"] for row in replay.values()), 3),
            "controlledMedianAdded": round(median(row["candidateMs"] for row in replay.values()), 3),
            "controlledMaxAdded": round(max(row["candidateMs"] for row in replay.values()), 3),
        },
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
