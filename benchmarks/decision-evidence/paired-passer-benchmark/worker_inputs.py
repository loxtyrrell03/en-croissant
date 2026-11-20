"""Export exact cached pair and reply frames for the existing worker replay."""
import argparse
import json
from pathlib import Path


def worker_inputs(cohorts, field):
    for split, rows in cohorts.items():
        for row in rows:
            result = row[field]
            candidates = result["root"]["lines"]
            if not candidates:
                continue
            yield {
                "id": f"{split}:{row['id']}",
                "fen": row["fen"],
                "history": row["history"],
                "playedMoveUci": row["played"],
                "candidates": candidates,
                "comparisonCandidates": candidates,
                "replyProbes": [
                    {"moveUci": arm["move"], "lines": arm["replies"]["lines"]}
                    for arm in result["compared"] if arm["replies"]["lines"]
                ],
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("field", choices=("reference", "stronger"))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = json.loads(args.file.read_bytes())
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(list(worker_inputs(rows, args.field)), stream, separators=(",", ":"))


if __name__ == "__main__":
    main()
