from pathlib import Path
import statistics,sys,json,hashlib,importlib.util
from collections import Counter,defaultdict

root=Path(sys.argv[1])
lab=Path(sys.argv[2])
out=Path(sys.argv[3])

def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    instance=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(instance)
    return instance

evaluator=module(Path("scripts/benchmarks/decision-evidence-evaluate.py"),"full_scope")
detection=evaluator.metrics.detection
read=lambda path:json.loads(path.read_bytes())
digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()

first={}
for name in ("course","independent","classical"):
    before_path=root/f"{name}-candidate-v13heldout.json"
    reference_path=root/f"{name}-reference-v13heldout.json"
    current_path=root/f"{name}-candidate-v33-audit.json"
    mid_path=root/f"{name}-candidate-v32-audit.json"
    initial=read(before_path)
    reference=read(reference_path)
    if digest(reference_path)!=initial["referenceSha256"]:
        raise ValueError(f"Reference bytes changed for {name}")
    first[name]={"referenceSha256":digest(reference_path),"originalOutputSha256":digest(before_path),
                 "frozenInputsSha256":initial["freezeSha256"],"questions":{}}
    for stage,path in (("v13",before_path),("v32",mid_path),("v33",current_path)):
        version=read(path)
        for a,b in zip(initial["results"],version["results"],strict=True):
            if any(a[key]!=b[key] for key in ("id","engineIdentity","probeIdentity")):
                raise ValueError("Mismatched frames")
            b["baseline"],b["baselineMistake"],b["baselineMs"]=a["baseline"],a["baselineMistake"],a["baselineMs"]
        report=evaluator.evaluate(reference,version)
        for scope,entry in report["questions"].items():
            converted=first[name]["questions"].setdefault(scope,{"questions":entry["cases"]})
            converted["original"]=entry["old"]
            converted[stage]=entry["candidate"]

archive_path=root/"reply-coverage-audit/full-pair-input.json"
archive=read(archive_path)
original,current=(read(lab/f"archive-{version}.json") for version in ("original","current"))
v33=read(lab/"threat-final-full-candidate.json")
orig_index={row["id"]:row for row in original}
current_index={row["id"]:row for row in current}
new_index={row["id"]:row["report"] for row in v33}
regions=defaultdict(list)
for row in archive:
    label=row.get("label")
    if not label:
        continue
    if row.get("playedMoveUci") and label.get("moveUci")!=row["playedMoveUci"]:
        raise ValueError(f"Misaligned played move {row['id']}")
    region=("mistake-mechanism" if row.get("playedMoveUci") else
            "ordinary-position" if label.get("scope")=="position-character" else "other-position")
    regions[region].append(row)

def mixed(item):
    tactical,positional=item.get("tactical"),item.get("positional")
    if tactical is True and positional is True:
        return True
    return False if tactical is False or positional is False else None

def latest(row,region):
    report=new_index[row["id"]] or {}
    result=report.get("mistake" if region=="mistake-mechanism" else "position") or {}
    return {d:result.get(d,{}).get("support")=="supported" for d in ("tactical","positional")}

pooled={}
for region,rows in regions.items():
    old=[orig_index[r["id"]] for r in rows]
    middle=[current_index[r["id"]] for r in rows]
    recent=[latest(r,region) for r in rows]
    labels=[r["label"] for r in rows]
    details={"cases":len(rows),"historyProvided":sum(bool(r.get("history")) for r in rows),
             "timeMedianMs":{"original":statistics.median(r["ms"] for r in old),
                             "v32":statistics.median(r["ms"] for r in middle)},
             "measurements":{}}
    for axis in ("tactical","positional","mixed"):
        expected=[mixed(r) if axis=="mixed" else r[axis] for r in labels]
        stats=details["measurements"][axis]={}
        if axis=="tactical" or (axis=="positional" and region=="mistake-mechanism"):
            stats["original"]=detection(expected,[r[axis] for r in old])
        else:
            stats["original"]=None
        if axis=="tactical" and region!="mistake-mechanism":
            stats["originalAnyLeadingMotif"]=detection(expected,[r["allLeading"] for r in old])
        for arm, predictions in (("v32",middle),("v33",recent)):
            stats[arm]=detection(expected,[r["tactical"] and r["positional"] if axis=="mixed" else r[axis] for r in predictions])
    pooled[region]=details

motif_path=root/"neural-motif-transfer/transfer-audit.json"
reference=read(motif_path)
old,new=(read(lab/f"motifs-{version}.json") for version in ("original","current"))
motifs={}
for group,previous in old.items():
    ids=list(previous)
    labels={r["id"]:r["labels"] for r in reference[group]}
    if set(ids)!=set(new[group]) or set(ids)!=set(labels):
        raise ValueError(f"Unmatched motif samples under {group}")
    known=sorted({k for ref in labels.values() for k,v in ref.items() if v is not None})
    motifs[group]={
        "cases":len(ids),"samePredictions":sum(set(previous[i]["root"])==set(new[group][i]["root"]) for i in ids),
        "themes":{k:{arm:detection([labels[i].get(k) for i in ids],[k in scores[i]["root"] for i in ids])
                     for arm,scores in (("original",previous),("v33",new[group]))} for k in known},
    }

report={"originalRevision":"a4428e35b42a1cc87f15003262268ed2c2baf26a",
        "originalSourceHashes":read(root/"baseline-source.json")["hashes"],
        "beforeQuietThreatsRevision":"8ff28909","archiveInputSha256":digest(archive_path),
        "motifInputSha256":digest(motif_path),"earlyReviewedCohorts":first,
        "archivedPositionAndMistakeReviews":pooled,"directRootMotifReplays":motifs}
with out.open("x",encoding="utf8",newline="\n") as stream:
    json.dump(report,stream,indent=2)
    stream.write("\n")
