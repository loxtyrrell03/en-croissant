"""Reuse the exact route-study roots and gather a game-disjoint puzzle reply sample."""

import argparse
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.engine

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "defence-after-attack"))
from gather import read, searched


def previous(research):
    for cohort in ("course", "independent"):
        for source in read(research / f"compared-motif-identity/{cohort}.json"):
            yield dict(source, cohort=cohort, id=f"{cohort}:{source['id']}")
    for source in read(research / "motif-causal-transfer/reserve-frames.jsonl"):
        yield dict(
            id=f"route:{source['id']}", cohort="named", fen=source["fen"], game=source["game"],
            candidates=[source["analysis"]], replyProbes=source["replyProbes"],
        )


def board_key(row):
    board = chess.Board(row["fen"])
    return min(board.epd(), board.mirror().epd())


def selected(research, quota, exclude):
    used = [*previous(research), *(row for path in exclude for row in read(path))]
    games = {r["game"] for r in used if r.get("game")}
    boards = {board_key(r) for r in used}
    cases = {r["id"].split(":")[-1].removeprefix("lichess-") for r in used}
    rows = read(research / "discovered-target-identity/puzzles.json")
    rows.sort(key=lambda item: sha256(f"scored-route-decisions-v1:{item['id']}".encode()).digest())
    for stratum in ("clearance", "deflection", "other"):
        count = 0
        for row in rows:
            if row["id"] in cases or row["game"] in games or board_key(row) in boards:
                continue
            motifs = set(row.get("tags", [])) & {"clearance", "deflection"}
            if (stratum == "other" and motifs) or (stratum != "other" and stratum not in motifs):
                continue
            if row["candidates"]:
                cases.add(row["id"])
                games.add(row["game"])
                boards.add(board_key(row))
                count += 1
                yield dict(row, cohort=stratum)
            if count >= quota:
                break


def reply(task):
    row, path, nodes = task
    board = chess.Board(row["fen"])
    move = row["candidates"][0]["pvUci"][0]
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        engine.configure({"Threads": 1, "Hash": 64})
        # The old motif archive contains supplied puzzle solutions with
        # placeholder scores. Analyse the actual root from scratch.
        roots = searched(engine, board, nodes // 2, fixed=[move])
        candidates = [dict(root, fen=board.fen()) for root in roots]
        board.push_uci(move)
        replies = searched(engine, board, nodes)
    return dict(row, candidates=candidates, replyProbes=[{
        "moveUci": move,
        "lines": [dict(line, fen=board.fen()) for line in replies],
    }])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("cached", "archive", "reserve"))
    parser.add_argument("research", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--nodes", type=int, default=4_800_000)
    parser.add_argument("--quota", type=int, default=12)
    parser.add_argument("--exclude", type=Path, nargs="*", default=[])
    args = parser.parse_args()
    if args.mode == "cached":
        rows = list(previous(args.research))
    elif args.mode == "archive":
        rows = [dict(row, cohort=f"archive-{row.get('cohort', 'x')}")
                for row in read(args.research / "reply-coverage-audit/full-pair-input.json")]
    else:
        if args.engine is None:
            parser.error("reserve mode requires --engine")
        sample = list(selected(args.research, args.quota, args.exclude))
        tasks = [(row, str(args.engine), args.nodes) for row in sample]
        with ProcessPoolExecutor(max_workers=5) as pool:
            rows = list(pool.map(reply, tasks))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(rows, stream, separators=(",", ":"))
    print(len(rows), "replay requests")


if __name__ == "__main__":
    main()
