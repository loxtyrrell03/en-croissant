"""Publish compact pawn-lever results, engine costs and the exact legal witnesses."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
from statistics import median


def read(file):
    return json.loads(file.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = {row["id"]: row for row in read(args.lab / "reserve.json")}
    baseline = {item["id"]: item["report"]["position"] for item in read(args.lab / "replay-v65-reserve.json")}
    reference = {row["id"]: row for row in read(args.lab / "reserve-reference.json")}
    results = {}
    for name, receipt in (
        ("app", "reserve-readback.json"),
        ("same-nodes-four", "reserve-control-width-readback.json"),
        ("deeper-three", "reserve-control-depth-readback.json"),
    ):
        audit = read(args.lab / receipt)
        frames = read(args.lab / f"reserve-{name}.json")
        witnesses = []
        for item in audit["cases"]:
            case = item["id"]
            shallow = item["shallow"]["grounded"]
            independent = item["independent"]["grounded"]
            if shallow or independent:
                witnesses.append(dict(id=case, source=rows[case]["source"],
                                      incumbent=baseline[case]["category"], matched=item["matched"]["settled"],
                                      proposed=shallow, independent=independent))
        results[name] = dict(cases=audit["total"], counts=audit["counts"], witnesses=witnesses,
                             frameHashes=audit["framesSha256"],
                             sameLeadingMove=sum(row["candidates"][0]["pvUci"][0] ==
                                                 reference[row["id"]]["candidates"][0]["pvUci"][0] for row in frames),
                             medianRootDepth=median(row["candidates"][0]["depth"] for row in frames),
                             rootNodes=sum(row["candidates"][0]["nodes"] for row in frames))
    result = dict(stockfishSha256=sha256(args.engine.read_bytes()).hexdigest(),
                  baselineRevision="2bc055dd", referenceMedianRootDepth=median(
                      row["candidates"][0]["depth"] for row in reference.values()),
                  referenceRootNodes=sum(row["candidates"][0]["nodes"] for row in reference.values()),
                  settings=results)
    with args.output.open("x", encoding="utf8", newline="\n") as out:
        json.dump(result, out, indent=2)
        out.write("\n")
    for setting, record in results.items():
        print(setting, record["medianRootDepth"], record["rootNodes"], record["sameLeadingMove"])


if __name__ == "__main__":
    main()
