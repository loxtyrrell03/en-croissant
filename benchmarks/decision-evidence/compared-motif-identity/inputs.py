"""Assemble matched, read-only decision evidence from retained benchmarks."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import chess


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def board_key(fen):
    state = chess.Board(fen)
    return min(state.epd(), state.mirror().epd())


def group(row):
    source = row.get("game") or row.get("sourceGroup")
    if source:
        return source[:16] if re.fullmatch(r"[a-f0-9]{32,64}", source) else source
    match = re.search(r"-([a-f0-9]{16})-\d+$", row["id"])
    return match.group(1) if match else row["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    base = Path("benchmarks/decision-evidence")
    archive_path = args.research / "reply-coverage-audit/full-pair-input.json"
    depth_path = args.research / "evidence-ceiling-v38/depth-input.json"
    archive = read(archive_path)
    games = {group(row) for row in archive}
    board_keys = {board_key(row["fen"]) for row in archive}
    reserve, source_counts = [], {}
    for f in ("tactical-recovery/controls.json", "tactical-recovery/deeper.json",
              "passed-pawn-interception/app-transfer/annotated.json",
              "passed-pawn-interception/app-transfer/summer.json",
              "passed-pawn-interception/app-transfer/late-reserve.json",
              "strategic-asset-contrast/replication.json", "strategic-asset-contrast/reserve.json"):
        path = base / f
        rows = read(path)
        stats = Counter(total=len(rows))
        for row in rows:
            move = row.get("playedMoveUci")
            if not move or not row.get("replyProbes"):
                stats["noPlayedReply"] += 1
                continue
            pair = row.get("comparisonCandidates") or row.get("candidates", [])
            if not pair or pair[0]["pvUci"][0] == move or not any(line["pvUci"][0] == move for line in pair):
                stats["noExactComparison"] += 1
                continue
            game = group(row)
            key = board_key(row["fen"])
            if key in board_keys or game in games:
                stats["overlap"] += 1
                continue
            board_keys.add(key)
            games.add(game)
            reserve.append(row)
            stats["retained"] += 1
        source_counts[f] = dict(stats, sha256=digest(path))
    destination = args.output
    destination.mkdir(exist_ok=True)
    files = {"archive-mistakes": [row for row in archive if row.get("playedMoveUci")],
             "reserve": reserve, "mixed-depth": read(depth_path)}
    for name in ("course", "independent"):
        files[name] = read(args.research / "mixed-axis-audit" / f"{name}-legacy-input.json")
    combined = [row for rows in files.values() for row in rows]
    if len({row["id"] for row in combined}) != len(combined):
        raise ValueError("Replay case identifiers collide")
    counts = {name: len(rows) for name, rows in files.items()}
    files["combined"] = combined
    for name, rows in files.items():
        path = destination / f"{name}.json"
        if path.exists():
            if read(path) != rows:
                raise ValueError(f"Replay input changed for {name}")
        else:
            with path.open("x", encoding="utf-8") as stream:
                json.dump(rows, stream)
    manifest = dict(archiveSha256=digest(archive_path), depthSha256=digest(depth_path),
                    counts=counts, reserveSources=source_counts)
    with (destination / "inputs.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
    print(manifest["counts"])


if __name__ == "__main__":
    main()
