"""Combine the frozen public inputs from the previous classical replays."""
import json
from pathlib import Path
import sys


def load(path):
    return json.loads(path.read_bytes())


def join(root: Path, output: Path):
    sets = (
        ("rook-file-consequence", "fresh", "fresh-input.json"),
        ("rook-file-consequence", "reserve", "reserve-input.json"),
        ("strategic-continuation-contrast", "independent", "independent-input.json"),
        ("strategic-continuation-contrast", "reserve", "reserve-input.json"),
        ("reply-consequence", "heldout", "heldout.json"),
        ("reply-consequence", "locks", "locks-heldout.json"),
    )
    rows = []
    for folder, prefix, file in sets:
        label_rows = load(root / folder / file)
        labels = {row["id"]: row["label"] for row in label_rows}
        engine_rows = load(root / folder / (prefix + "-engine.json"))
        if len(engine_rows) != len(labels):
            raise ValueError(f"Missing labels for {folder}/{prefix}")
        for row in engine_rows:
            stripped = {key: row[key] for key in
                        ("id", "fen", "sourceGroup", "event", "candidates", "replyProbes", "referenceReplies")}
            stripped.update(cohort=f"{folder}/{prefix}", label=labels[row["id"]])
            rows.append(stripped)
    for key in ("id", "fen", "sourceGroup"):
        if len({row[key] for row in rows}) != len(rows):
            raise ValueError(f"Repeated {key} between public sets")
    with output.open("x", encoding="utf8", newline="\n") as stream:
        stream.write("[\n" + ",\n".join(json.dumps(row, separators=(",", ":")) for row in rows) + "\n]\n")


if __name__ == "__main__":
    join(*map(Path, sys.argv[1:]))
