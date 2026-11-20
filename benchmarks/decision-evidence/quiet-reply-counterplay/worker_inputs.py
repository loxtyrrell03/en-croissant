"""Build matched replay inputs and the exact checks for new nominations."""
import argparse
from pathlib import Path

from freeze_sample import read, write


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("trial", type=Path)
parser.add_argument("output_directory", type=Path)
args = parser.parse_args()
common, candidate, questions = [], [], []
core = ("id", "fen", "history", "candidates", "replyProbes")
source = ("id", "event", "site", "history", "fen", "roles")
for row in read(args.trial):
    frame = {key: row[key] for key in core}
    common.append(frame)
    passed = next((item for item in row["attempts"] if item["confirmed"]), None)
    if not passed:
        candidate.append(frame)
        continue
    branch = passed["nomination"]
    candidate.append(dict(frame, quietReply=dict(
        rootMoveUci=branch["root"],
        replies=[branch["saferReply"], branch["replyFrame"]],
        answers=passed["independent"],
    )))
    questions.append(dict({key: row[key] for key in source}, recordedRoot=branch["root"], recordedReply=branch["reply"]))
for name, rows in (
    ("common-worker-input.json", common),
    ("release-input.json", candidate),
    ("confirmed-questions.json", questions),
):
    write(args.output_directory / name, rows)
