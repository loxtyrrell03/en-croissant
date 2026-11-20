"""Select one non-preserving legal move per known public board by fixed hash."""

import argparse
from hashlib import sha256
import json
from pathlib import Path


OUTCOME = {"loss": -1, "blessed-loss": 0, "draw": 0, "cursed-win": 0, "win": 1}


def select(sample, recorded):
    certificates = {row["id"]: row.get("evidence") for row in recorded}
    result = []
    for row in sample["sample"]:
        certificate = certificates[row["id"]]
        if not certificate:
            continue
        root = certificate["records"][0]["result"]
        inferior = [
            move["uci"] for move in root["moves"]
            if -OUTCOME[move["category"]] < OUTCOME[root["category"]]
        ]
        if not inferior:
            continue
        move = min(inferior, key=lambda uci: sha256((row["id"] + "|alternative|" + uci).encode()).digest())
        result.append(dict(row, playedMoveUci=move))
    return {"sample": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("sample", "records", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    result = select(json.loads(args.sample.read_bytes()), json.loads(args.records.read_bytes()))
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(result, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main()
