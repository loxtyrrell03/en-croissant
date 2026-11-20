"""Compare the worker reports and attach the source-audited transfer evidence."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median

import chess


def read(file):
    return json.loads(file.read_bytes())


def reports(rows):
    return {r["id"]: r.get("report") for r in rows}


def outcome_on_locked_left(results, deep):
    deeper = {case["id"]: case for case in deep if case.get("result")}
    repeat = 0
    related = 0
    same_threat = 0
    for case in results:
        if not case.get("result") or case["id"] not in deeper:
            continue
        other = deeper[case["id"]]
        if all(case[name] == other[name] for name in ("preferred", "alternative", "replyUci")):
            repeat += 1
        elif all(case[name] == other[name] for name in ("alternative", "replyUci")):
            same_threat += 1
        elif case["preferred"] == other["preferred"]:
            related += 1
    return {"exactRepeat": repeat, "sameThreatDifferentDefence": same_threat,
            "samePreferredDifferentContinuation": related}


def evaluate(root_rows, before_rows, after_rows, actual, excluded):
    current, previous = reports(after_rows), reports(before_rows)
    assert current.keys() == previous.keys() == {row["id"] for row in root_rows}
    candidates = {row["id"]: row for row in actual}
    with_label, effects, transitions = Counter(), [], Counter()
    for row in root_rows:
        identity = row["id"]
        if identity in excluded:
            continue
        old, new = previous[identity], current[identity]
        if old is None or new is None:
            assert old is None and new is None
            continue
        for key in old.keys() - {"version", "position"}:
            assert old[key] == new[key], (identity, key)
        label = row.get("label") or {}
        for method, report in (("before", old), ("after", new)):
            if label.get("scope") == "position-character" and isinstance(label.get("tactical"), bool):
                support = report["position"]["tactical"]["support"] == "supported"
                with_label[f"{method}:{label['tactical']}:{support}"] += 1
        if old["position"] == new["position"]:
            continue
        known = candidates[identity]
        assert known.get("result")
        p, q = old["position"], new["position"]
        assert p["positional"] == q["positional"]
        assert q["tacticalContrast"] == known["result"]
        transitions[(p["category"], q["category"])] += 1
        evidence = q["tacticalContrast"]
        board = chess.Board(row["fen"])
        def san(moves):
            return board.variation_san([chess.Move.from_uci(v) for v in moves])
        effects.append({
            "id": identity,
            "site": row.get("site"),
            "event": row.get("event"),
            "labelKind": label.get("scope"),
            "before": p["category"],
            "after": q["category"],
            "reason": evidence["explanation"],
            "refuted": san(evidence["playedLineUci"]),
            "better": san(evidence["betterLineUci"]),
            "controlled": san(evidence["controlLineUci"]) if evidence.get("controlLineUci") else None,
        })
    return {
        "inputCount": len(root_rows) - len(excluded),
        "validCount": sum(identity not in excluded and value is not None
                          for identity, value in current.items()),
        "transitions": {f"{a} → {b}": count for (a, b), count in transitions.items()},
        "reviewedTacticalLabels": dict(with_label),
        "changed": effects,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("lab", "run", "engine", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    lab, run = args.lab, args.run
    audited = read(run / "fresh-audit.json")
    skipped = set(audited["sameGameAudit"]) | set(audited["sharedFamilyCases"])
    fixed = read(run / "same-roots-results.json")
    result = {"baselineRevision": "8e38f00f", "stockfishSha256": sha256(args.engine.read_bytes()).hexdigest()}
    for name, inputs, baseline, product, removed in (
        ("archive", lab / "settled-exchange-plans/base-input.json",
         lab / "settled-exchange-plans/full-product.json", run / "archive-product.json", set()),
        ("fresh", run / "fresh-replies.json", run / "fresh-8e38f00f-report.json", run / "fresh-index-report.json", skipped),
    ):
        source = read(inputs)
        arms = {mode: read(run / f"{name}-{mode}-results.json") for mode in ("similar", "causal", "ranked")}
        accepted = {mode: [row for row in cases if row["id"] not in removed]
                    for mode, cases in arms.items()}
        confirmations = accepted["causal"]
        detail = {
            "arms": {method: {"nominated": len(rows), "corroborated": sum(bool(row.get("result")) for row in rows)}
                     for method, rows in accepted.items()},
            "inputHashes": {p.name: sha256(p.read_bytes()).hexdigest() for p in (inputs, baseline, product)},
            "worker": evaluate(source, read(baseline), read(product), confirmations, removed),
        }
        cost = read(run / f"{name}-causal-probes.json")
        captured = [row["queries"] for identity, row in cost.items() if identity not in removed and row is not None]
        detail["engineProbeCost"] = {
            "queries": sum(map(len, captured)),
            "medianElapsedMs": round(median(sum(q["milliseconds"] for q in row) for row in captured), 1),
        }
        detail["strongerUnrestricted"] = outcome_on_locked_left(
            confirmations, read(run / f"{name}-deep-results.json")
        )
        detail["strongerSameThreeChoices"] = outcome_on_locked_left(confirmations, fixed)
        result[name] = detail
    result["fresh"]["excludedAfterArchiveOverlapCheck"] = sorted(skipped)
    with args.output.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write("\n")
    for name in ("archive", "fresh"):
        report = result[name]
        print(name, json.dumps({
            "arms": report["arms"],
            "transitions": report["worker"]["transitions"],
            "reviewedTacticalLabels": report["worker"]["reviewedTacticalLabels"],
            "unrestricted": report["strongerUnrestricted"],
            "sameThreeChoices": report["strongerSameThreeChoices"],
        }))


if __name__ == "__main__":
    main()
