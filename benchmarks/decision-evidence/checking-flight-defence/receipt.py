"""Assemble the frozen replay inputs and compact coverage receipts."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from probe import screen


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def source_inputs(lab, run):
    previous = read(lab / "promotion-check-tempo/live-final.json")
    lugano = [r for r in previous if r["id"] == "passer-pair-24058c51cfa95ff0"]
    assert len(lugano) == 1
    write(run / "lugano.json", lugano)


def app_inputs(lab, run):
    archive, _ = screen(lab)
    fresh = read(run / "reserve-scored.json")
    stress = read(run / "stress-scored.json")
    write(run / "app-screen.json", {
        "archive": [*read(run / "lugano.json"), *archive], "fresh": fresh, "stress": stress,
    })


def verify_receipt(run):
    development = read(run / "archive-final.json")
    fresh, stress = [read(run / f"{name}-results.json") for name in ("reserve", "stress")]
    control = development["results"]
    assert len(control) == 1 and control[0]["row"]["id"] == "passer-pair-24058c51cfa95ff0"
    assert not fresh["results"] and not stress["results"]
    nominated = {}
    for budget in ("shallow", "reference", "repeat"):
        row = control[0][budget]
        assert row["status"] == "confirmed"
        nominated[budget] = {
            "defenderScoresCp": row["scoreCp"], "weakerPayoff": row["weakPayoff"],
            "requestedNodes": sum(q["requestedNodes"] for q in row["queries"]),
            "engineWallMs": round(sum(q["milliseconds"] for q in row["queries"]), 2),
        }
    live_baseline, live, later = [read(run / f"live-{name}.json") for name in ("baseline", "product", "final")]
    assert all(live[key] == later[key] for key in ("queries", "move", "mistake", "evidence", "selectiveFrames"))
    assert live["queries"][:len(live_baseline["queries"])] == live_baseline["queries"]
    archive = read(run / "app-screen-results.json")
    result = {
        "baseline": "f851ecda", "stockfishSha256": development["engineSha256"],
        "retainedInputs": development["sources"], "freshExclusions": read(run / "exclusions.json"),
        "sampleHashes": {name: sha256((run / f"{name}.json").read_bytes()).hexdigest()
                         for name in ("reserve", "reserve-scored", "stress-scored")},
        "appScreen": archive,
        "freshBudget": dict(Counter(row["status"] for row in read(run / "reserve-scored.json"))),
        "geometryBudget": dict(Counter(row["status"] for row in read(run / "stress-scored.json"))),
        "luganoBudget": nominated,
        "live": {
            "baseline": {"queries": len(live_baseline["queries"]), "move": live_baseline["move"],
                         "mistake": live_baseline["mistake"], "elapsedMs": round(live_baseline["milliseconds"])},
            "enabled": {"queries": len(live["queries"]), "move": live["move"],
                        "mistake": live["mistake"], "elapsedMs": round(live["milliseconds"]),
                        "extra": live["queries"][len(live_baseline["queries"]):]},
            "matchedLaterRun": True,
        },
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("lugano", "stress", "screen", "summarize"))
    parser.add_argument("lab", type=Path)
    parser.add_argument("run", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.mode == "lugano":
        source_inputs(args.lab, args.run)
    elif args.mode == "stress":
        write(args.run / "stress.json", [row for row in read(args.run / "reserve.json")
                                         if row["cohort"] == "geometry"])
    elif args.mode == "screen":
        app_inputs(args.lab, args.run)
    else:
        write(args.output, verify_receipt(args.run))


if __name__ == "__main__":
    main()
