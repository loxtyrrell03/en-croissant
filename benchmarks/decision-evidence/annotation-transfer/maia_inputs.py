"""Adapt sealed annotation frames to the fixed Maia position transfer runner."""

import argparse
from hashlib import sha256
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_bytes())


def index(rows):
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate decision in the transfer inputs")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("frames", "reference", "worker", "samples", "reports"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    reference = read(args.reference)
    if sha256(args.frames.read_bytes()).hexdigest() != reference["appFrameSha256"]:
        raise ValueError("The frames differ from the sealed annotation benchmark")
    labels = index(reference["cases"])
    frames = index(read(args.frames))
    worker = index(read(args.worker))
    if frames.keys() != labels.keys() or frames.keys() != worker.keys():
        raise ValueError("Different case IDs across the transfer inputs")
    samples, reports = [], []
    for case_id, frame in frames.items():
        reviewed = labels[case_id]
        report = worker[case_id]["report"]
        if frame["playedMoveUci"] != reviewed["uci"] or report["version"] != 63:
            raise ValueError(f"Wrong move or worker revision for {case_id}")
        candidate_lines = frame["candidates"]
        if len(candidate_lines) != 3:
            raise ValueError(f"Expected three legal lines for {case_id}")
        label = reviewed["position"]
        event = {"development": "candidates-open-2026", "reserve": "candidates-women-2026"}[frame["split"]]
        samples.append(dict(id=case_id, fen=frame["fen"], candidates=candidate_lines,
                            sourceGroup=frame["game"], event=event, label=label))
        reports.append(dict(id=case_id, label=label, baseline=report["position"]))
    for path, rows in ((args.samples, samples), (args.reports, reports)):
        with path.open("x", encoding="utf8", newline="\n") as stream:
            json.dump(rows, stream, allow_nan=False, indent=2)
            stream.write("\n")


if __name__ == "__main__":
    main()
