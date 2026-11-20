"""Reuse frozen public game searches and the paired witness controls."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


INPUTS = {
    "archive": "reply-coverage-audit/full-pair-input.json",
    "concordance": "reply-concordance/reserve-scored.json",
    "capture-reserve": "alternate-capture-payoff/fresh-scored.json",
    "short-mate-reserve": "played-mate-in-three/reserve-scored.json",
    "paired-study-deep": "paired-passer-benchmark/worker-input.json",
}


def prepare(lab, phases):
    all_rows, sources = [], {}
    for name, relative in phases.items():
        raw = (lab / relative).read_bytes()
        sources[name] = sha256(raw).hexdigest()
        rows = [dict(row, id=f"{name}:{row['id']}", cohort=name) for row in json.loads(raw)]
        all_rows.extend(rows)
    return all_rows, sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("lab", "output", "manifest"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    rows, manifest = prepare(args.lab, INPUTS)
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(rows, out, separators=(",", ":"))
    with args.manifest.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(manifest, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
