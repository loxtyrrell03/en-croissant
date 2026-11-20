"""Compare the matched worker reports and summarize the independent rechecks."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
from statistics import median

import chess

from prepare import read


def keyed(path):
    data = read(path)
    result = {row["id"]: row for row in data}
    if len(result) != len(data):
        raise ValueError("Duplicate case identities")
    return result


def check_tactical(mistake):
    return (mistake.get("tactical") or {}).get("support") == "supported"


def compare(inputs, first, second):
    assert inputs.keys() == first.keys() == second.keys()
    totals = defaultdict(Counter)
    labels = {"v42": Counter(), "v43": Counter()}
    improved = []
    for case_id, known in inputs.items():
        prior, current = first[case_id]["report"], second[case_id]["report"]
        assert bool(prior) == bool(current), case_id
        if not prior:
            continue
        scope = known["cohort"]
        stats = totals[scope]
        stats["valid"] += 1
        stats["positionChanges"] += prior["position"] != current["position"]
        stats["moveChanges"] += prior["moves"] != current["moves"]
        old, new = prior["mistake"] or {}, current["mistake"] or {}
        stats["mistakeChanges"] += old != new
        recorded = known.get("label") or {}
        if scope == "archive" and recorded.get("scope") == "mistake-mechanism":
            assert recorded["moveUci"] == known["playedMoveUci"]
            expected = recorded.get("tactical")
            for name, report in (("v42", old), ("v43", new)):
                called = check_tactical(report)
                tag = "uncertain-called" if called else "uncertain"
                if expected is not None:
                    tag = ("tp" if called else "fn") if expected else ("fp" if called else "tn")
                labels[name][tag] += 1
        if check_tactical(new) and not check_tactical(old):
            stats["addedTactical"] += 1
            stats["addedMixed"] += new.get("category") == "mixed"
            item = dict(id=case_id, cohort=scope, prior=old.get("category"), after=new["category"],
                        reference=recorded.get("tactical"),
                        episode=new["tacticalEpisode"]["explanation"])
            episode = new["tacticalEpisode"]
            board = chess.Board(known["fen"])
            item["playedLine"] = board.variation_san(map(chess.Move.from_uci, episode["playedLineUci"]))
            item["betterLine"] = board.variation_san(map(chess.Move.from_uci, episode["betterLineUci"]))
            improved.append(item)
    times = {name: round(median(row["ms"] for row in results.values() if row["report"]), 2)
             for name, results in (("v42", first), ("v43", second))}
    return dict(byCohort=totals, reviewedArchiveTactical=labels, added=improved, medianWorkerMs=times)


def diagnose(rows):
    totals = defaultdict(Counter)
    for row in rows.values():
        per = totals[row["cohort"]]
        per["requests"] += 1
        for key in ("eligible", "outcome", "prevented", "capture"):
            per[key] += bool(row.get(key))
    return totals


def recheck(root, inputs, pilot):
    compared = keyed(root / f"{inputs}.json")
    cases = []
    for case_id, item in keyed(root / f"{pilot}.json").items():
        frame = compared[case_id]
        controlled = frame.get("controlledAttack") or []
        board = chess.Board(frame["fen"])
        pair = frame["comparisonCandidates"]
        probes = [probe["lines"][0] for probe in frame["replyProbes"]]
        played = board.copy()
        played.push_uci(frame["playedMoveUci"])
        cases.append(dict(
            id=case_id, comparedScoresCp=[line["cp"] for line in pair],
            replyScoresCp=[line["cp"] for line in probes],
            pairedPlayedLine=board.variation_san(map(chess.Move.from_uci, pair[1]["pvUci"][:7])),
            playedReplyLine=played.variation_san(map(chess.Move.from_uci, probes[1]["pvUci"][:6])),
            sameAttackOnBetterCp=controlled[0]["cp"] if controlled else None,
            sameAttackLegal=bool(controlled), repeatedCapture=bool(item["capture"]),
            repeatedNamed=bool(item["prevented"]),
        ))
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = args.runs
    data = {}
    for name, inputs, first, second, scout in (
        ("cached", "inputs.json", "worker-v42.json", "worker-v43.json", "expanded-final.json"),
        ("fresh", "standard-fresh.json", "fresh-v42.json", "fresh-v43.json", "standard-pilot.json"),
    ):
        path = root / inputs
        data[name] = compare(keyed(path), keyed(root / first), keyed(root / second))
        data[name]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        data[name]["methods"] = diagnose(keyed(root / scout))
    data["independentRechecks"] = recheck(root, "rechecked", "rechecked-pilot")
    data["freshRecheck"] = recheck(root, "fresh-rechecked", "fresh-rechecked-pilot")
    data["freshSampling"] = json.loads((root / "standard-manifest.json").read_bytes())
    with args.output.open("x", encoding="utf-8") as out:
        json.dump(data, out, indent=2)
        out.write("\n")


if __name__ == "__main__":
    main()
