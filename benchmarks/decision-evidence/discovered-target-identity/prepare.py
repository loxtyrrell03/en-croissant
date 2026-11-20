from pathlib import Path
import json
import sys

lab, output, mode = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
if mode == "archive":
    source = lab / "reply-budget-allocation"
    allowed = {row["id"] for row in json.loads((source/"capture-full.json").read_bytes())}
    rows = [r for r in json.loads((source/"archive-input.json").read_bytes()) if r["id"] in allowed]
    if len(rows) != len(allowed):
        raise ValueError("The archived frames differ from their receipt")
else:
    source = lab / "neural-search-yield"
    rows = []
    for cohort in ("test", "reserve"):
        for line in (source/(cohort+".jsonl")).read_bytes().splitlines():
            row = json.loads(line)
            if row.get("skipped"):
                continue
            deep = row["deep"]
            row["candidates"] = deep["root"]
            row["comparisonCandidates"] = deep["root"]
            row["replyProbes"] = [
                {"moveUci": row["candidate"], "lines": deep["better"]},
                {"moveUci": row["playedMoveUci"], "lines": deep["played"]},
            ]
            rows.append({k:v for k,v in row.items() if k not in ("deep","short")})
with output.open("x", encoding="utf-8") as stream:
    json.dump(rows, stream, separators=(",",":"))
print(len(rows), "prepared")
