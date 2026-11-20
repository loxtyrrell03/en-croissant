"""Prepare exactly matched engine frames and the legacy dual-question replay."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def write(out, rows):
    with out.open("x", encoding="utf-8") as stream:
        json.dump(rows, stream, separators=(",", ":"))


def early(root, out):
    rows = []
    identities = set()
    for cohort in ("course", "independent", "classical"):
        reference_path = root / f"{cohort}-reference-v13heldout.json"
        prior = read(root / f"{cohort}-candidate-v13heldout.json")
        assert digest(reference_path) == prior["referenceSha256"]
        for item in prior["results"]:
            key = item["id"]
            assert key not in identities
            identities.add(key)
            engine_path = root / f"{cohort}-engine-v13heldout" / f"{key}.json"
            probe_path = root / f"{cohort}-probes-v13heldout" / f"{key}.json"
            engine, probes = read(engine_path), read(probe_path)
            assert digest(engine_path) == probes["identity"]["root_sha256"]
            assert engine["identity"] == item["engineIdentity"]
            assert probes["identity"] == item["probeIdentity"]
            assert engine["deep"] and all(x["fen"] == engine["deep"][0]["fen"] for x in engine["deep"])
            row = dict(id=key, fen=engine["deep"][0]["fen"], candidates=engine["deep"],
                       replyProbes=probes["replyProbes"], playedMoveUci=engine["played"],
                       comparisonCandidates=engine.get("comparison"), cohort=cohort)
            rows.append({k:v for k,v in row.items() if v is not None})
    write(out, rows)


def legacy(scored, out):
    fields = ("fen", "history", "candidates", "comparisonCandidates", "replyProbes", "playedMoveUci")
    rows = []
    for row in read(scored):
        basic = {key:row[key] for key in fields if key in row}
        for label in ("position", "mistake"):
            scope = "position-character" if label == "position" else "mistake-mechanism"
            item = dict(basic,id=row["id"]+"#"+label,label={"scope":scope})
            if label == "position":
                item.pop("playedMoveUci")
                item.pop("comparisonCandidates", None)
            rows.append(item)
    write(out, rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("early", "legacy"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    (early if args.mode == "early" else legacy)(args.input, args.output)
