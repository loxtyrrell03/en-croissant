"""Build disjoint classical inputs and independent short Stockfish frames."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from time import perf_counter
import argparse
import json
import re
import sys

import chess
import chess.pgn

SUITES = Path.cwd() / "benchmarks/decision-evidence"
sys.path.insert(0, str(SUITES / "reply-search-allocation"))
from sample import board_key, classical_sources, preview_game
from search import engines, search


def records(file):
    raw = file.read_bytes().strip()
    return json.loads(raw) if raw.startswith(b"[") else [json.loads(s) for s in raw.splitlines()]


def write(file, rows):
    with file.open("x", encoding="utf-8") as out:
        json.dump(rows, out, separators=(",", ":"))


def key(*parts):
    return sha256("|".join(map(str, parts)).encode()).hexdigest()


def family(event):
    # Collapse sections of the same broadcast event, plus named section-first aliases.
    if "european-youth" in event:
        return "european-youth-2026"
    if "pakistan-national" in event or "pakistan-national" in event.replace("chess-", ""):
        return "pakistan-national"
    return re.split(r"(?<=20\d\d)-", event, maxsplit=1)[0]


def initial(row):
    history = row.get("history")
    if not history:
        raise ValueError("The comparison requires a game history")
    board = chess.Board(history["fen"])
    for move in history["moves"]:
        board.push_uci(move)
    if board.fen() != row["fen"]:
        raise ValueError(f"History and board disagree for {row['id']}")
    return board


def game_key(row):
    return key(row["history"]["fen"], *row["history"]["moves"][:24])


def training_pairs(row):
    played = row.get("playedMoveUci")
    pair = row.get("comparisonCandidates") or []
    if len(pair) != 2 or not played or any(not r["pvUci"] for r in pair):
        return None
    first, second = [r["pvUci"][0] for r in pair]
    if second != played or first == played:
        return None
    probes = {r["moveUci"]: r["lines"] for r in row.get("replyProbes", [])}
    if any(len(probes.get(move, [])) < 2 for move in (first, second)):
        return None
    return dict(root=pair, better=probes[first][:2], played=probes[second][:2])


def select(lab, train_path, test_path, test_size):
    sources = [
        lab / "blocked-defensive-resource/reserve-frames.jsonl",
        *sorted(lab.glob("*/*classical-reserve-frames.jsonl")),
        *sorted(lab.glob("*/*/*classical-reserve-frames.jsonl")),
        lab / "mixed-comparison-pass/development-frames.jsonl",
        lab / "mixed-comparison-pass/reserve-frames.jsonl",
        lab / "reply-budget-allocation/archive-input.json",
    ]
    archive = [r for file in sources for r in records(file) if r.get("fen")]
    visited_boards = {board_key(chess.Board(r["fen"])) for r in archive}
    visited_games = {game_key(r) for r in archive if r.get("history")}
    public = defaultdict(list)
    already = set()
    for file, (event, site) in sorted(classical_sources(lab).items()):
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                moves = [m.uci() for m in game.mainline_moves()]
                if len(moves) < 45:
                    continue
                signature = key(game.board().fen(), *moves[:24])
                if signature in visited_games or signature in already:
                    continue
                already.add(signature)
                row = preview_game(game, signature, event, site)
                if not row or board_key(chess.Board(row["fen"])) in visited_boards:
                    continue
                row["game"] = signature
                public[family(event)].append(row)
    # Freeze full event families, with enough games for each to report its own yield.
    possible = [event for event, rows in public.items() if len(rows) >= 18]
    events = sorted(possible, key=lambda event: key("deep-witness-v1", event))[:8]
    ranked = {event: sorted(public[event], key=lambda r: key("deep-witness-v1", r["id"])) for event in events}
    test = []
    seen_boards = set()
    for i in range(min(map(len, ranked.values()))):
        for event in events:
            row = ranked[event][i]
            identity = board_key(chess.Board(row["fen"]))
            if identity not in seen_boards:
                seen_boards.add(identity)
                test.append(row)
            if len(test) == test_size:
                break
        if len(test) == test_size:
            break
    if len(test) != test_size:
        raise ValueError("The test sample did not reach the frozen quota")
    train = []
    train_games = set()
    keep = ("id", "fen", "history", "playedMoveUci", "event", "site")
    for row in sorted(archive, key=lambda r: key("train-deep-witness-v1", r["id"])):
        if not all(row.get(field) for field in keep) or family(row["event"]) in events:
            continue
        history = row["history"]
        if len(history["moves"]) < 24 or not row["site"].startswith("https://lichess.org/broadcast/"):
            continue
        cached = training_pairs(row)
        if cached is None:
            continue
        signature = game_key(row)
        identity = board_key(chess.Board(row["fen"]))
        if signature in train_games or identity in seen_boards or initial(row).is_game_over(claim_draw=True):
            continue
        train_games.add(signature)
        seen_boards.add(identity)
        item = {k: row[k] for k in keep}
        train.append(dict(item, game=signature, candidate=cached["root"][0]["pvUci"][0],
                          deep=cached))
    if train_games & {r["game"] for r in test}:
        raise ValueError("A game crossed the split")
    write(train_path, train)
    write(test_path, test)
    print("Training", len(train), "games from", len({family(r["event"]) for r in train}), "families",
          "test", len(test), "games from", events, flush=True)


def frames(row, executable):
    board = initial(row)
    played = row["playedMoveUci"]
    candidate = row.get("candidate")
    if not candidate:
        root = search(board, executable, 600_000, 2)["lines"]
        if len(root) < 2:
            return dict(row, skipped="root-insufficient")
        candidate = root[0]["pvUci"][0]
        if candidate == played:
            return dict(row, skipped="played-leads-reference-root")
        pair = search(board, executable, 600_000, 2, [board.parse_uci(m) for m in (candidate, played)])["lines"]
        if len(pair) < 2 or pair[0]["pvUci"][0] != candidate:
            return dict(row, skipped="reference-ranking-disagrees")
        row["deep"] = {"root": pair}
    row["candidate"] = candidate
    moves = [board.parse_uci(move) for move in (candidate, played)]
    for slot, move in zip(("better", "played"), moves, strict=True):
        child = board.copy()
        child.push(move)
        ranks = min(2, child.legal_moves.count())
        if not ranks:
            return dict(row, skipped="terminal-child")
        if slot not in row["deep"]:
            row["deep"][slot] = search(child, executable, 1_200_000, ranks)["lines"]
        row.setdefault("short", {})[slot] = search(child, executable, 52_000, ranks)["lines"]
    return row


def gather(source, output, executable):
    start = perf_counter()
    rows = records(source)
    try:
        with output.open("x", encoding="utf-8") as out, ThreadPoolExecutor(7) as pool:
            for index, result in enumerate(pool.map(lambda r: frames(r, executable), rows), 1):
                out.write(json.dumps(result, separators=(",", ":")) + "\n")
                out.flush()
                if index % 25 == 0:
                    print(index, "/", len(rows), "in", round(perf_counter() - start, 1), "seconds", flush=True)
    finally:
        for engine in engines:
            engine.quit()
    print(len(rows), "frames", sha256(output.read_bytes()).hexdigest(), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sample = commands.add_parser("select")
    for name in ("lab", "train", "test"):
        sample.add_argument(name, type=Path)
    sample.add_argument("--test-size", type=int, default=128)
    search_frames = commands.add_parser("gather")
    for name in ("source", "output", "engine"):
        search_frames.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == "select":
        select(args.lab, args.train, args.test, args.test_size)
    else:
        gather(args.source, args.output, str(args.engine))


if __name__ == "__main__":
    main()
