from pathlib import Path
from collections import Counter
import chess
import json
import candidate_geometry as audit
import sys


def evaluate(row, deep=False):
    forced, after = (row[key] for key in (("deepForced", "deepFollowup") if deep else ("forced","followup")))
    root = chess.Board(row["fen"])
    response = row["sameReply"]
    played = row["playedReplies"][0] if row["playedReplies"] else row.get("verifyWeaker")
    if not all(audit.reliable(line) for line in (played, forced, after)):
        return "mate, shallow, or incomplete",{}
    if played["pvUci"][:1]!=[response]:
        return "different reply after worse move",{}
    if abs(row["playedRoot"]["cp"] + played["cp"]) > 90:
        return "worse score disagreement",{}
    if abs(forced["cp"]+after["cp"])>90 or forced["cp"]>-row["betterRoot"]["cp"]+90 or played["cp"]-forced["cp"]<100:
        return "counterfactual score insufficient",{}
    if forced["pvUci"][1:2] != after["pvUci"][:1]:
        return "different response to shared capture",{}
    answer = after["pvUci"][0]
    if answer not in dict(row["novel"]):
        return "response also legal in played branch",{}
    lines=[audit.mod.sequence(root,pv,17) for pv in (
        [row["better"],*forced["pvUci"]],
        [row["better"],response,*after["pvUci"]],
        row["playedRoot"]["pvUci"],
        [row["weaker"],*played["pvUci"]],
    )]
    evidence=audit.mod.proof(root,lines)
    if not evidence:
        return "no attributable material recovery",{"reply":dict(row["novel"])[answer],"lines":[[step.san for step in line] for line in lines]}
    return "supported recovery",evidence


if __name__ == "__main__":
    source = Path(sys.argv[1])
    rows = (json.loads(source.read_bytes()) if source.suffix == ".json"
            else [json.loads(line) for line in source.read_text(encoding="utf8").splitlines()])
    out = []
    totals = Counter()
    for row in rows:
        receipt = {"id": row["id"], "lesserCandidateUci": row["weaker"]}
        for label, deep in (("oneMillion", False), ("fourMillion", True)):
            status, evidence = evaluate(row, deep)
            totals[label, status] += 1
            receipt[label] = {"status": status, "proof": evidence.get("local-recovery")}
        out.append(receipt)
    print(totals)
    if len(sys.argv) > 2:
        with Path(sys.argv[2]).open("x", encoding="utf8") as stream:
            json.dump(out, stream, indent=2)
