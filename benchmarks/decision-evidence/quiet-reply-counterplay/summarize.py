"""Summarize the recorded-response check and the scoped TypeScript replay."""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys


def read(path):
    return json.loads(path.read_bytes())


def lookup(items):
    rows = {row["id"]: row for row in items}
    assert len(rows) == len(items)
    return rows


scratch, output = map(Path, sys.argv[1:3])
reference = lookup(read(scratch / "holdout-reference.json"))
trials = lookup(read(scratch / "holdout-trials.json"))
checked = lookup(read(scratch / "confirmed-reference.json"))
base = lookup(read(scratch / "base-worker.json"))
current = lookup(read(scratch / "v58-worker.json"))
assert trials.keys() == reference.keys() == base.keys() == current.keys()
issued = []
changes = []
for case, row in trials.items():
    if reference[case]["label"] == "ordinary-unreviewed":
        assert not row["attempts"]
    untouched = {k:v for k,v in base[case]["report"].items() if k != "version"}
    upgraded = {k:v for k,v in current[case]["report"].items() if k != "version"}
    assert untouched["mistake"] == upgraded["mistake"]
    assert untouched["position"]["positional"] == upgraded["position"]["positional"]
    assert [x["positional"] for x in untouched["moves"]] == [x["positional"] for x in upgraded["moves"]]
    if untouched != upgraded:
        changes.append(case)
    for attempt in row["attempts"]:
        if not attempt["confirmed"]:
            continue
        proposal = attempt["nomination"]
        control = checked[case]
        assert control["label"] == "positive"
        assert control["proposal"]["root"] == proposal["root"]
        assert control["proposal"]["reply"] == proposal["reply"]
        left = next(x for x in untouched["moves"] if x["moveUci"] == proposal["root"])
        right = next(x for x in upgraded["moves"] if x["moveUci"] == proposal["root"])
        issued.append(dict(
            id=case, event=row["event"], site=row["site"], originalRecordedReply=row["recordedReply"],
            provenReply=proposal["reply"], root=proposal["root"],
            recordedReference=reference[case]["label"],
            exactReferenceMatch=(row["recordedRoot"],row["recordedReply"]) == (proposal["root"],proposal["reply"]),
            appReplyGapCp=proposal["gap"], deeperReplyGapCp=control["proposal"]["gap"],
            position=[untouched["position"]["category"], upgraded["position"]["category"]],
            candidate=[left["category"], right["category"]],
            laterLineUci=[proposal["root"], proposal["reply"], *control["independent"][0]["pvUci"][:10]],
            proof=right.get("quietReply"),
        ))
assert len(changes) == 2
raw = [attempt for row in trials.values() for attempt in row["attempts"]]
cost = [query for row in trials.values() for query in row["searches"] if query["reason"] != "frame"]
receipt = {
    "baseline": "27580772",
    "sampleSha256": sha256((scratch/"holdout.json").read_bytes()).hexdigest(),
    "stockfishSha256": "45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0",
    "cases": len(trials),
    "groups": len({row["group"] for row in trials.values()}),
    "sampleClasses": dict(Counter(row["category"] for row in trials.values())),
    "recordedReferences": dict(Counter(row["label"] for row in reference.values())),
    "trials": {arm: dict(
        attempts=sum(x["arm"]==arm for x in raw),
        previewNominations=sum(x["arm"]==arm and "nomination" in x for x in raw),
        confirmed=sum(x["arm"]==arm and x["confirmed"] for x in raw),
    ) for arm in ("cached","targeted")},
    "extraSearch": dict(queries=len(cost),requestedNodes=sum(q["nodes"] for q in cost),
                        lastCompleteFrameNodes=sum(q["complete"] for q in cost),
                        queryTypes=dict(Counter(q["reason"] for q in cost)),ordinaryQueries=0),
    "matchesToRecordedPositive": sum(x["exactReferenceMatch"] and x["recordedReference"]=="positive"
                                    for x in issued),
    "publishedExplanations": len(changes),
    "changedReports": changes,
    "changedMistakes": 0,
    "casesWithConfirmedCounterplay": issued,
}
with output.open("x", encoding="utf8", newline="\n") as stream:
    json.dump(receipt,stream,indent=2,ensure_ascii=False)
    stream.write("\n")
