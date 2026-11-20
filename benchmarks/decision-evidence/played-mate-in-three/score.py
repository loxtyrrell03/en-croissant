"""Score each mate-three arm and independently check its exported proof."""

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from statistics import median
import sys

from reference import Referee


def load(path):
    return json.loads(path.read_bytes())


def index(path):
    rows = load(path)
    indexed = {row["id"]: row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError(f"Duplicate IDs in {path}")
    return indexed


def report_for(row):
    return row.get("report") or {}


def exact_three(report):
    mate = (report.get("mistake") or {}).get("mateConsequence")
    return mate if mate and mate["kind"] == "allowed" and mate["mateIn"] == 3 else None


def verify_proof(row, consequence):
    line = consequence["lineUci"]
    if len(line) != 6 or line[0] != row["playedMoveUci"]:
        raise ValueError(f"Wrong line scope in {row['id']}")
    history = row["history"]
    verifier = Referee(history["fen"], history["moves"])
    if verifier.board.fen() != row["fen"]:
        raise ValueError(f"Wrong original board in {row['id']}")
    verifier.push(verifier.board.parse_uci(line[0]))
    is_quiet = not verifier.board.gives_check(verifier.board.parse_uci(line[1]))
    for uci in line[1:]:
        verifier.push(verifier.board.parse_uci(uci))
    if not verifier.board.is_checkmate():
        raise ValueError(f"Exported line does not end in legal mate in {row['id']}")
    for _ in line[2:]:
        verifier.pop()
    # Check every defence to the exact published attack, not a different mate.
    if verifier.defend(2, frozenset(line[3::2])) is None:
        raise ValueError(f"Displayed mating start has a refutation in {row['id']}")
    if other := consequence.get("avoidingLineUci"):
        replacement = Referee(history["fen"], history["moves"])
        for uci in other:
            replacement.push(replacement.board.parse_uci(uci))
        if replacement.attack(2) is not None:
            raise ValueError(f"Displayed defence still allows a short mate in {row['id']}")
    return is_quiet


def measure(rows, refs, inputs, verify=False):
    if rows.keys() != refs.keys() or refs.keys() != inputs.keys():
        raise ValueError("Matched frames or references missing")
    metrics = Counter()
    proofs = []
    for key, row in rows.items():
        reference = refs[key]["verdict"]
        proof = exact_three(report_for(row))
        metrics[reference] += 1
        if not proof:
            continue
        metrics[f"called_{reference}"] += 1
        if verify and proof.get("proof") == "legal":
            proofs.append({"id": key, "quiet": verify_proof(inputs[key], proof), **proof})
    return {
        "count": len(rows),
        "truePositive": metrics["called_positive"],
        "falsePositive": metrics["called_negative"],
        "falseNegative": metrics["positive"] - metrics["called_positive"],
        "trueNegative": metrics["negative"] - metrics["called_negative"],
        "unknown": metrics["unknown"],
        "calledOnUnknown": metrics["called_unknown"],
        "newProofs": proofs,
        "medianWorkerMs": round(median(row["ms"] for row in rows.values()), 2),
    }


def archive_agreement(before, after):
    if before.keys() != after.keys():
        raise ValueError("Mismatched archive IDs")
    changes = Counter()
    for key in before:
        old, new = report_for(before[key]), report_for(after[key])
        for scope in ("position", "moves", "mistake", "mistakeStatus"):
            changes[scope] += old.get(scope) != new.get(scope)
    return {"requests": len(before), "valid": sum(bool(report_for(row)) for row in after.values()),
            "changedByScope": changes}


def main(lab, prior, output):
    groups = {
        "development": ["dev-base", "dev-original-nominated", "dev-original-checking", "dev-original-all", "dev-original-shown", "dev-v2", "prod-dev-final"],
        "reserve": ["reserve-full-base", "reserve-nominated", "reserve-checking", "reserve-all",
                    "reserve-shown", "reserve-incomplete-base", "reserve-incomplete",
                    "prod-full-final", "prod-incomplete-final"],
    }
    result = {
        "baseline": "c9e35249",
        "product": "Decision Evidence v51",
        "provenance": {},
        "groups": {},
    }
    for name, arms in groups.items():
        inputs_path = lab / f"{name}-scored.json"
        ref_path = lab / f"{name}-reference.json"
        inputs, labels = index(inputs_path), index(ref_path)
        result["provenance"][name] = {
            "sampleSha256": sha256((lab / f"{name}.json").read_bytes()).hexdigest(),
            "scoredSha256": sha256(inputs_path.read_bytes()).hexdigest(),
            "referenceSha256": sha256(ref_path.read_bytes()).hexdigest(),
            "events": len({row["event"] for row in inputs.values()}),
            "strata": Counter(row["stratum"] for row in inputs.values()),
            "referenceReasons": Counter(row["reason"] for row in labels.values()),
        }
        result["groups"][name] = {
            arm: measure(index(lab / f"{arm}.json"), labels, inputs, arm.startswith("prod-"))
            for arm in arms
        }
    result["archive"] = archive_agreement(
        index(prior / "reply-concordance/archival-product-product.json"), index(lab / "archive-final.json"),
    )
    inputs = index(lab / "reserve-scored.json")
    heldout_proofs = result["groups"]["reserve"]["prod-incomplete-final"]["newProofs"]
    result["heldoutSavedCompletedReplyNodes"] = sum(
        max(line["nodes"] for line in probe["lines"])
        for case in heldout_proofs
        for row in [inputs[case["id"]]]
        for probe in row["replyProbes"]
        if probe["moveUci"] == row["playedMoveUci"]
    )
    result["live"] = {name: load(lab / f"live-{name}.json") for name in ("base-pinned", "product")}
    result["sourceFiles"] = load(lab / "manifest.json")
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main(*(Path(arg) for arg in sys.argv[1:]))
