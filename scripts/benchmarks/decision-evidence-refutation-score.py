"""Score frozen move nominations against verifier results and position reviews."""

import argparse
import hashlib
import json
from pathlib import Path


ARMS = ("stockfish", "shallow_reply", "logistic_ordered", "tree_ordered",
        "neural_pooled", "neural_ordered")


def load(path):
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), json.loads(raw)


def indexed(rows):
    result = {row["id"]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError("Repeated position in a benchmark input")
    return result


def nominal(row, arm, labelled):
    ranking = row["rankings"][arm]
    if len(ranking) != len(set(ranking)) or set(ranking) != set(labelled["outcomes"]):
        raise ValueError(f"Ranked candidate set differs for {row['id']}")
    move = next(iter(ranking), None)
    if arm == "stockfish" and move != labelled["baseline"]:
        raise ValueError(f"Stockfish baseline differs for {row['id']}")
    result = labelled["outcomes"].get(move, {})
    return dict(id=row["id"], event=row["event"], move=move, proof=result.get("proof", False),
                payoff=result.get("payoff"), nodes=result.get("requestedNodes", 0))


def report(rows, labels, base=None, references=None):
    by_id = indexed(rows)
    if by_id.keys() - labels.keys() or (base is not None and
            (base.keys() != by_id.keys() or references.keys() != by_id.keys())):
        raise ValueError("Benchmark results, engine proofs and review coverage differ")
    labelled = {key: labels[key] for key in by_id if labels[key]["eligible"]}
    oracle = {key for key, row in labelled.items() if any(result["proof"] for result in row["outcomes"].values())}
    summary = dict(positions=len(by_id), eligible=len(labelled), availableProofPositions=len(oracle), arms={})
    if base is not None:
        positions = {key: (row.get("assessment") or {}).get("position", {}) for key, row in base.items()}
        base_tactical = {key for key, position in positions.items()
                         if position.get("tactical", {}).get("support") == "supported"}
        summary["reviewedBaselineTactical"] = sum(references[key]["tactical"] is True for key in base_tactical)
        summary["reviewedTacticalWithAnyExtraChoice"] = sum(
            references[key]["tactical"] is True for key in base_tactical | oracle
        )
    for arm in ARMS:
        candidates = {key: nominal(by_id[key], arm, row) for key, row in labelled.items()}
        route = dict(choices=sum(row["move"] is not None for row in candidates.values()),
                     proofs=sum(row["proof"] for row in candidates.values()))
        if base is not None:
            predictions = {}
            for key, position in positions.items():
                tactical = key in base_tactical
                positional = position.get("positional", {}).get("support") == "supported"
                candidate = candidates.get(key, {})
                # Existing verified evidence takes precedence, as in the app.
                predictions[key] = dict(baseT=tactical, baseP=positional,
                                        addedT=candidate.get("proof", False) and not tactical,
                                        checked=key in candidates and not tactical,
                                        candidate=candidate)
            active = [value["candidate"] for value in predictions.values() if value["checked"]]
            route["app"] = dict(
                additionalNodes=sum(90_000 + value["nodes"] for value in active),
                verifiedExtraChoices=sum(value["proof"] for value in active),
                additionalProofs=[value["candidate"] for value in predictions.values() if value["addedT"]],
            )
            axes = {}
            for axis in ("tactical", "positional", "mixed"):
                counts = dict(tp=0, fp=0, fn=0, tn=0, unknown=0)
                for key, val in predictions.items():
                    ref = references[key]
                    if axis == "mixed":
                        truth = (False if False in (ref["tactical"], ref["positional"])
                                 else True if ref["tactical"] is True and ref["positional"] is True else None)
                    else:
                        truth = ref[axis]
                    chosen_t = val["baseT"] or val["addedT"]
                    pred = chosen_t if axis == "tactical" else val["baseP"]
                    if axis == "mixed":
                        pred = chosen_t and val["baseP"]
                    counts["unknown" if truth is None else ("t" if truth == pred else "f") + ("p" if pred else "n")] += 1
                axes[axis] = counts
            route["app"]["axes"] = axes
        summary["arms"][arm] = route
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rankings", type=Path)
    parser.add_argument("development", type=Path)
    parser.add_argument("holdout_inputs", type=Path)
    parser.add_argument("holdout_search", type=Path)
    parser.add_argument("holdout_labels", type=Path)
    parser.add_argument("freeze", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cohort", nargs=3, action="append", required=True,
                        metavar=("NAME", "BASELINE", "REFERENCE"))
    args = parser.parse_args()
    rank_sha, rank = load(args.rankings)
    dev_sha, dev = load(args.development)
    input_sha, inputs = load(args.holdout_inputs)
    evidence_sha, evidence = load(args.holdout_search)
    _, hold = load(args.holdout_labels)
    freeze_sha, freeze = load(args.freeze)
    if (rank["labelsSha256"] != dev_sha or hold["searchSha256"] != evidence_sha
            or rank["holdoutSha256"] != input_sha or rank["rankerSha256"] !=
            freeze["source"]["scripts/benchmarks/decision-evidence-refutation-ranker.py"]):
        raise ValueError("Rankings or proof files differ from their frozen inputs")
    for obj, expected in ((rank["developmentSha256"], "development-search.json"),
                          (dev_sha, "development-labels.json"), (input_sha, "holdout-inputs.json")):
        if obj != freeze["inputs"][expected]:
            raise ValueError(f"Freeze mismatch {expected}")
    if (evidence["engineSha256"] != inputs["engineSha256"] or evidence["inputs"] != inputs["inputs"]
            or [{key: value for key, value in row.items() if key != "searches"} for row in evidence["results"]]
            != inputs["results"]):
        raise ValueError("Verification must use the frozen original and short frames")
    hold_labels = indexed(hold["labels"])
    output = dict(rankingsSha256=rank_sha, freezeSha256=freeze_sha,
                  development=report(rank["development"], indexed(dev["labels"])), holdout={})
    all_ids = set()
    for name, base, reference in args.cohort:
        _, benchmark = load(Path(base))
        ref_sha, reviewed = load(Path(reference))
        if ref_sha != freeze["inputs"][Path(reference).name] or ref_sha != benchmark["referenceSha256"]:
            raise ValueError(f"Reference {name} is not the frozen input")
        refs = indexed(reviewed["cases"])
        if all_ids & refs.keys():
            raise ValueError("Holdout cohort overlap")
        all_ids.update(refs)
        subset = [row for row in rank["holdout"] if row["id"] in refs]
        output["holdout"][name] = report(subset, hold_labels, indexed(benchmark["results"]), refs)
    if all_ids != indexed(rank["holdout"]).keys():
        raise ValueError("Some held-out rankings were not scored")
    with args.output.open("x", encoding="utf8", newline="\n") as stream:
        json.dump(output, stream, indent=2)
    for phase, result in [("development", output["development"]), *output["holdout"].items()]:
        print(phase, result["availableProofPositions"], "positions with an available verified proof")
        for arm, row in result["arms"].items():
            print(arm, row["proofs"], "/", row["choices"], row.get("app", {}).get("axes", {}))


if __name__ == "__main__":
    main()
