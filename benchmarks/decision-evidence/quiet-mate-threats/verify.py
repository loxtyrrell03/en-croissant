from collections import Counter
from pathlib import Path
import chess,sys,json
def read(path):
    return json.loads(path.read_bytes())
def verify(row,witness):
    defence_lines=witness["defenceLinesUci"]
    origin=chess.Board(row["fen"])
    variants=witness["ignoredLineUci"]
    first=origin.parse_uci(variants[0])
    assert not origin.is_check() and not origin.is_capture(first) and not origin.gives_check(first)
    origin.push(first)
    for _,reply in defence_lines:
        defended=origin.copy()
        defended.push_uci(reply)
        for candidate in defended.legal_moves:
            after=defended.copy()
            after.push(candidate)
            assert not after.is_checkmate()
    original=origin.copy()
    original.turn=not original.turn
    original.ep_square=None
    original.push_uci(variants[2])
    assert original.is_checkmate()
    prior=origin.copy()
    prior.push_uci(variants[1])
    prior.push_uci(variants[2])
    assert prior.is_checkmate()
def compare(inputs,old,new):
    counts={}
    change=[]
    for row,before,after in zip(inputs,old,new,strict=True):
        assert row["id"]==before["id"]==after["id"]
        a,b=before["report"],after["report"]
        label=row.get("stratum","archive")
        totals=counts.setdefault(label,Counter())
        totals["inputs"]+=1
        if not a or not b:
            assert a==b
            continue
        totals["valid"]+=1
        a.pop("version",None); b.pop("version",None)
        if a==b: continue
        assert a["mistake"]==b["mistake"] and a["mistakeStatus"]==b["mistakeStatus"]
        totals["changedReports"]+=1
        src=b["position"]
        calls=[move["quietMateThreat"] for move in b["moves"] if move.get("quietMateThreat")]
        assert calls
        for proof in calls:
            verify(row,proof)
        totals["positionEvidenceAdded"]+=bool(src.get("quietMateThreat"))
        totals["moveEvidenceAdded"]+=len(calls)
        totals["positionTacticalAdded"]+=a["position"]["tactical"]["support"]!="supported" and b["position"]["tactical"]["support"]=="supported"
        change.append({"id":row["id"],"stratum":label,"before":a["position"]["category"],"after":src["category"],"witnesses":calls,"labelTactical":(row.get("label") or {}).get("tactical")})
    return counts,change

if __name__ == "__main__":
    defaults = Path(__file__).parent
    baseline, candidate, *extra = map(Path, sys.argv[1:])
    if len(extra) > 1:
        raise ValueError("Supply baseline, candidate, and optionally the shared input file")
    inputs = read(extra[0]) if extra else read(defaults/"development.json")+read(defaults/"reserve.json")
    counts, changes = compare(inputs, read(baseline), read(candidate))
    print(json.dumps({"counts":counts,"newEvidence":len(changes)}, indent=2))
