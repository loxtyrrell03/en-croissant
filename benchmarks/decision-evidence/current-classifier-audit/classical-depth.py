"""Replay the unchanged classifier on the independent, wider and deeper frames."""
import argparse
from collections import Counter
from pathlib import Path

from classical_score import (
    ALLOWED_INPUT, AXES, SCOPES, assessment, bootstrap, checked_inputs, detection,
    digest, exact_index, mixed, prediction, read, write,
)


def compare(app, deep, labels, standard, stronger):
    standard = exact_index(standard)
    stronger = exact_index(stronger)
    deep = exact_index(deep)
    if set(standard) != set(stronger) or set(stronger) != set(labels):
        raise ValueError("Missing replay output.")
    same_leader = {
        row["id"] for row in app
        if row["candidates"][0]["pvUci"][0] == deep[row["id"]]["candidates"][0]["pvUci"][0]
    }
    results = {}
    for scope in SCOPES:
        rows = []
        missing = []
        changed = []
        for row in app:
            key = row["id"]
            label = labels[key][scope]
            choices = [assessment(replay[key]["report"] or {}, scope, labels[key]["move"]["uci"])
                       for replay in (standard, stronger)]
            if scope == "move" and any(choice is None for choice in choices):
                missing.append(key)
                continue
            values = [prediction(choice, scope) for choice in choices]
            rows.append((key, row["group"], label, values))
            if any(values[0][axis] != values[1][axis] for axis in AXES):
                changed.append(dict(id=key, sameLeader=key in same_leader,
                                    reference={a: label[a] for a in AXES[:2]},
                                    standard={a: values[0][a] for a in AXES},
                                    deeper={a: values[1][a] for a in AXES}))
        comparison = {}
        for name, candidates in (
            ("allAvailable", rows),
            ("sameLeadingMove", [row for row in rows if row[0] in same_leader]),
        ):
            partitions = {}
            for axis in AXES:
                refs = [mixed(label) if axis == "mixed" else label[axis] for _, _, label, _ in candidates]
                partitions[axis] = {}
                for index, setting in enumerate(("app", "deeper")):
                    bits = [values[index][axis] for _, _, _, values in candidates]
                    result = detection(refs, bits)
                    result["eventBootstrap"] = bootstrap(refs, bits, [group for _, group, _, _ in candidates])
                    partitions[axis][setting] = result
            comparison[name] = dict(cases=len(candidates), axes=partitions)
        outcomes = Counter(
            (values[1]["tactical"], values[1]["positional"])
            for _, _, ref, values in rows if mixed(ref) is True
        )
        results[scope] = dict(
            **comparison,
            exactCandidateUnavailable=missing,
            changedAxes=changed,
            deeperMixedPositiveBreakdown={
                f"tactical={tactical},positional={positional}": count
                for (tactical, positional), count in sorted(outcomes.items())
            },
        )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("deep", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--score", type=Path)
    args = parser.parse_args()
    cases, labels = checked_inputs(args.app, args.reference)
    reference = read(args.reference)
    if digest(args.deep) != reference["engineFrameSha256"]["deep"]:
        raise ValueError("Deeper frames differ from the ones used for review.")
    deep = read(args.deep)
    if set(exact_index(deep)) != set(labels):
        raise ValueError("Deeper frames differ from the frozen sample.")
    if not args.score:
        write(args.directory / "classical-deeper-input.json", [
            {key: row[key] for key in ("id", *ALLOWED_INPUT) if key in row} for row in deep
        ])
        return
    result = compare(cases, deep, labels, read(args.directory / "classical-v57.json"),
                     read(args.directory / "classical-v57-deeper.json"))
    write(args.score, dict(
        revision="27580772", referenceSha256=digest(args.reference), inputs=reference["engineFrameSha256"],
        experiment="Cached wider and deeper Stockfish frames, unchanged classifier",
        warning="This uses the frames reviewed for the reference. It diagnoses evidence availability and agreement, not prospective accuracy at the deeper budget.",
        results=result,
    ))


if __name__ == "__main__":
    main()
