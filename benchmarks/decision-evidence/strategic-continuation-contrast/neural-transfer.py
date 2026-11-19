"""Retest the frozen Maia-3 position probes on new classical events.

Use the same training split, fitted heads, and equal review budget as in the
original Maia position experiment. Each transfer supplies engine lines, manual
references, and the clean incumbent result for the same position.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits


def load_position_runner(repo):
    path = repo / "scripts/benchmarks/decision-evidence-maia-position-probe.py"
    spec = importlib.util.spec_from_file_location("maia_position", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_evaluation(probe, model, input_path, result_path):
    inputs = probe.read(input_path)
    reports = {row["id"]: row for row in probe.read(result_path)}
    rows, frames = [], {}
    for item in inputs:
        case_id, fen, lines = item["id"], item["fen"], item["candidates"]
        result = reports[case_id]
        if item["label"] != result["label"]:
            raise ValueError(f"Different reference for {case_id}")
        current = {axis: result["baseline"][axis]["support"] == "supported"
                   for axis in model.AXES[:2]}
        label = {axis: item["label"][axis] for axis in model.AXES[:2]}
        for pair in (current, label):
            pair["mixed"] = model.joint(pair["tactical"], pair["positional"])
        scores, continuation = model.features(fen, lines)
        rows.append(model.Decision(case_id, " ".join(fen.split()[:4]), item["sourceGroup"],
                                   item["event"], label, current, scores, continuation))
        frames[case_id] = fen, lines
    for attribute in ("id", "board", "game"):
        if len({getattr(row, attribute) for row in rows}) != len(rows):
            raise ValueError(f"Repeated {attribute} in the transfer set")
    return rows, frames


def direct_mixed_predictions(training, testing, features):
    """Fit only on agreed mixed labels, with the same frozen board encoder."""
    known = [row for row in training if row.label["mixed"] is not None]
    labels = [row.label["mixed"] for row in known]
    board_features = "line-maia-root"
    line_scaler = StandardScaler()
    latent_scaler = StandardScaler()
    line_scaler.fit(np.stack([row.continuation for row in known]))
    latent_scaler.fit(np.stack([features[row.id][board_features] for row in known]))

    def inputs(rows):
        lines = line_scaler.transform(np.stack([row.continuation for row in rows]))
        latent = latent_scaler.transform(np.stack([features[row.id][board_features] for row in rows]))
        return lines, np.column_stack([lines, latent * np.sqrt(lines.shape[1] / latent.shape[1])])

    train_lines, train_augmented = inputs(known)
    test_lines, test_augmented = inputs(testing)
    # Compare the latent representation against the same head and engine input.
    arms = {
        "direct-line-logistic": (LogisticRegression(C=.1), train_lines, test_lines),
        "direct-line-network": (
            MLPClassifier(hidden_layer_sizes=(16,), alpha=.1, solver="lbfgs",
                          random_state=47, max_iter=3000), train_lines, test_lines),
        "direct-maia-root": (LogisticRegression(C=.1), train_augmented, test_augmented),
    }
    return {
        arm: {"mixed": head.fit(train, labels).predict_proba(test)[:, 1]}
        for arm, (head, train, test) in arms.items()
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--train", type=Path, nargs=2, required=True)
    parser.add_argument("--transfer", type=Path, nargs=2, required=True)
    args = parser.parse_args()
    position = load_position_runner(args.repo)
    probe = position.load_probe()
    original = probe.read(args.repo / "benchmarks/decision-evidence/maia-branch-probe/position-protocol.json")
    if ([probe.sha256(path) for path in args.train] != original["replays"]["training"]
            or probe.sha256(args.checkpoint) != original["checkpoint"]):
        raise ValueError("Training or Maia checkpoint differs from the original protocol")
    model = probe.import_sibling("decision-evidence-line-model.py")
    replay, manifest = args.train
    training = model.load(replay, manifest)
    testing, frames = load_evaluation(probe, model, *args.transfer)
    probe.validate_split(training, testing)
    sources = {source["name"]: source for source in probe.read(manifest)}
    for case in probe.read(replay)["results"]:
        row, source = case["row"], sources[case["source"]]
        path = Path(source["cache"]) / f"tournament-engine-{source['profile']}" / f"{row['id']}.json"
        frames[row["id"]] = row["fen"], probe.read(path)["deep"][:3]
    encoder = probe.Encoder(args.checkpoint)
    features = {case_id: position.position_features(probe, encoder, fen, lines)
                for case_id, (fen, lines) in frames.items()}
    with threadpool_limits(limits=1):
        predictions = probe.probe(training, testing, features, model, score_control="stockfish-gap")
        direct = direct_mixed_predictions(training, testing, features)
    results = probe.score(testing, predictions, model.AXES)
    frozen_gate = {axis: probe.passes_gate(cell) for axis, cell in results.items()}
    mixed_comparison = {arm: {"mixed": ranks["mixed"]} for arm, ranks in predictions.items()}
    mixed_comparison.update(direct)
    direct_mixed = probe.score(testing, mixed_comparison, ("mixed",))["mixed"]
    probe.NEURAL = (*probe.NEURAL, "direct-line-network", "direct-maia-root")
    report = {
        "training": len(training), "transfer": len(testing),
        "inputs": [probe.sha256(path) for path in args.transfer],
        "medianNetworkForwardMs": float(np.median(encoder.model_times["pretrained"][1:])),
        "additionalEngineNodes": 0,
        "results": results,
        "directMixed": direct_mixed,
        "directMixedPassesGate": probe.passes_gate(direct_mixed),
        "passesFrozenGate": frozen_gate,
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write("\n")


if __name__ == "__main__":
    main()
