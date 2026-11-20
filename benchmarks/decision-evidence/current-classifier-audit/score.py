"""Refresh an audited comparison on byte-matched private engine frames."""
import argparse
from collections import Counter
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
from statistics import median

REPO = Path(__file__).resolve().parents[3]
evaluator_path = REPO / "scripts/benchmarks/decision-evidence-evaluate.py"
spec = importlib.util.spec_from_file_location("scope_eval", evaluator_path)
evaluator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluator)
detection = evaluator.metrics.detection


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def lookup(rows):
    result = {row["id"]:row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Duplicate case identity")
    return result


def supported(report):
    report = report or {}
    return {name:report.get(name,{}).get("support")=="supported"
            for name in ("tactical","positional")}


def mixed(label):
    if label["tactical"] is True and label["positional"] is True:
        return True
    if label["tactical"] is False or label["positional"] is False:
        return False
    return None


def tally(labels, before, after, older=None, *, is_mistake, current="v47"):
    arms={"original": before, current: after}
    if older is not None:
        arms["v33"] = older
    result={}
    for axis in ("tactical","positional","mixed"):
        reference=[mixed(label) if axis=="mixed" else label[axis] for label in labels]
        result[axis]={}
        for name, predictions in arms.items():
            if name=="original" and axis!="tactical" and not (axis=="positional" and is_mistake):
                result[axis][name]=None
                continue
            bits=[item.get("tactical",False) and item.get("positional",False)
                  if axis=="mixed" else item.get(axis,False) for item in predictions]
            result[axis][name]=detection(reference,bits)
    mixed_breakdown=Counter()
    for label,prediction in zip(labels,after,strict=True):
        if mixed(label):
            vector = (prediction["tactical"],prediction["positional"])
            mixed_breakdown[{(True,True):"both",(True,False):"tactical only",
                             (False,True):"positional only",(False,False):"neither"}[vector]]+=1
    return dict(cases=len(labels),axes=result,mixed_breakdown=dict(mixed_breakdown))


def archived(lab, scratch, current):
    archive_file=lab/"reply-coverage-audit/full-pair-input.json"
    rows=lookup(read(archive_file))
    old=lookup(read(lab/"unified-audit/archive-original.json"))
    previous=lookup(read(lab/"unified-audit/threat-final-full-candidate.json"))
    now=lookup(read(scratch/f"archive-{current}.json"))
    assert rows.keys()==now.keys()
    result={"inputSha256":digest(archive_file),"queries":len(rows),"scopes":{}}
    for scope in ("ordinary position","other reviewed position","classical mistake"):
        subgroup=[]
        for row in rows.values():
            label=row.get("label")
            if not label: continue
            observed=("classical mistake" if row.get("playedMoveUci") else
                      "ordinary position" if label.get("scope")=="position-character" else
                      "other reviewed position")
            if scope!=observed:continue
            if scope=="classical mistake" and label["moveUci"]!=row["playedMoveUci"]:
                raise ValueError("Wrong recorded move")
            subgroup.append(row)
        question="mistake" if scope=="classical mistake" else "position"
        method=lambda material,row:supported((material[row["id"]]["report"] or {}).get(question))
        details=tally([x["label"] for x in subgroup],[old[x["id"]] for x in subgroup],
                      [method(now,x) for x in subgroup],[method(previous,x) for x in subgroup],
                      is_mistake=question=="mistake", current=current)
        details["medianMs"]={name:median(outputs[x["id"]]["ms"] for x in subgroup)
                             for name,outputs in (("original",old),(current,now))}
        result["scopes"][scope]=details
    return result


def frozen_cohorts(lab, scratch, references, tag):
    current=lookup(read(scratch/f"early-{tag}.json"))
    matched_input=references/"matched-early.json"
    matched=lookup(read(matched_input))
    result={"inputSha256":digest(matched_input),"cohorts":{}}
    for cohort in ("course","independent","classical"):
        ref=lab/f"{cohort}-reference-v13heldout.json"
        initial=read(lab/f"{cohort}-candidate-v13heldout.json")
        assert digest(ref)==initial["referenceSha256"]
        for item in initial["results"]:
            identity=item["id"]
            assert matched[identity]["cohort"]==cohort
            item["assessment"]=current[identity]["report"]
            item["milliseconds"]=current[identity]["ms"]
        result["cohorts"][cohort]={"referenceSha256":digest(ref), "results":evaluator.evaluate(read(ref),initial)}
    return result


def prospective(scratch, references, tag):
    reference_file=references/"prospective-reference.json"
    reference=read(reference_file)
    assert reference["scoredInputSha256"]==digest(references/"prospective-scored.json")
    old=lookup(read(references/"prospective-original.json"))
    current=lookup(read(scratch/f"prospective-{tag}.json"))
    result={"sources":read(references/"prospective-manifest.json"),"reviewSha256":digest(reference_file),
            "scoredInputSha256":reference["scoredInputSha256"],"scope":{}}
    for kind in ("position", "mistake"):
        label_scope="position-character" if kind=="position" else "mistake-mechanism"
        labels=[case for case in reference["cases"] if case["scope"]==label_scope]
        assert {case["id"] for case in labels}==current.keys()
        result["scope"][kind]=tally(labels,[old[case["id"]+"#"+kind] for case in labels],
                      [supported((current[case["id"]]["report"] or {}).get(kind)) for case in labels],
                      is_mistake=kind=="mistake", current=tag)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("classifier_research","replay_directory","output"):
        parser.add_argument(name,type=Path)
    parser.add_argument("--tag", default="v47")
    parser.add_argument("--revision", default="ae4bf1fc")
    parser.add_argument("--references", type=Path, help="Earlier immutable input and label directory")
    args=parser.parse_args()
    lab,scratch=args.classifier_research,args.replay_directory
    references=args.references or scratch
    results=dict(revision=args.revision,historical_archive=archived(lab,scratch,args.tag),
                 previously_reviewed=frozen_cohorts(lab,scratch,references,args.tag),
                 prospective=prospective(scratch,references,args.tag))
    with args.output.open("x",encoding="utf-8") as out:
        json.dump(results,out,indent=2,ensure_ascii=False)
        out.write("\n")


if __name__=="__main__":
    main()
