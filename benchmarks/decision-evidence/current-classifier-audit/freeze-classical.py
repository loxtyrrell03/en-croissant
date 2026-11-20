"""Freeze a phase- and rating-balanced classical audit before classifier replay."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re

import chess
import chess.pgn

from freeze import Broadcast, board_key, identity

SEED = "decision-classical-generalization-2026-11"
TARGET = 8
GROUP_CAP = 10
PHASES = ("ply 24–42", "ply 43–69", "ply 70–110")
RATINGS = ("below 1800", "1800–2199", "2200 and above")


def read(path):
    return json.loads(path.read_bytes())


def write(path, data):
    with path.open("x", encoding="utf8") as out:
        json.dump(data, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")


def ticket(*parts):
    return identity(SEED, list(map(str, parts)))


def event_family(slug):
    # An initial year is only a date prefix, not a tournament identity.
    suffix = re.search(r"[a-z].*?-(20\d\d)(?:-|$)", slug)
    return slug[:suffix.end(1)] if suffix else slug


def windows(source, game_id, boards):
    root = source.board()
    opening_fen = root.fen()
    moves = list(source.mainline_moves())
    trace = [move.uci() for move in moves]
    windows = {}
    for ply, move in enumerate(moves):
        actor = "White" if root.turn else "Black"
        elo = source.headers.get(actor + "Elo", "")
        if (24 <= ply <= min(110, len(moves) - 6)
                and elo.isdecimal() and 1000 <= int(elo) <= 3000
                and len(root.piece_map()) >= 9 and root.halfmove_clock < 35
                and not root.is_check() and not root.is_game_over() and board_key(root) not in boards):
            phase = PHASES[0 if ply <= 42 else 1 if ply <= 69 else 2]
            elo = int(elo)
            rating = RATINGS[0 if elo < 1800 else 1 if elo < 2200 else 2]
            stratum = (rating, phase)
            order = ticket(game_id, ply)
            if stratum not in windows or order < windows[stratum]["id"]:
                windows[stratum] = dict(id=order, game=game_id, fen=root.fen(), ply=ply,
                                        rating=elo, ratingBand=rating, phase=phase,
                                        playedMoveUci=trace[ply],
                                        history=dict(fen=opening_fen, moves=trace[:ply]))
        root.push(move)
    return windows


def select(sources, base, prior):
    old_games = set()
    old_boards = set()
    old_events = set()
    old_sites = set()
    receipts = []
    for input_path in prior:
        for row in read(input_path):
            old_boards.add(board_key(chess.Board(row["fen"])))
            history = row.get("history") or {}
            if len(history.get("moves", ())) >= 24:
                old_games.add(identity(history["fen"], history["moves"]))
            if event := row.get("event"):
                old_events.add(event_family(event))
            if site := row.get("site") or row.get("sourceUrl"):
                matched = re.match(r"https://lichess\.org/broadcast/([^/]+)/", site)
                if matched:
                    old_events.add(event_family(matched[1]))
                old_sites.add(site)
        receipts.append(dict(file=input_path.name, sha256=sha256(input_path.read_bytes()).hexdigest()))
    seen = set(old_games)
    files = []
    pools = defaultdict(list)
    for metadata in sources:
        source = base / metadata["file"]
        event = metadata["slug"]
        if event_family(event) in old_events:
            continue
        group = metadata.get("group") or event
        valid = 0
        with source.open(encoding="utf-8-sig", errors="strict") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Broadcast)) is not None:
                if (game.errors or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}
                        or game.board().chess960 or not game.board().is_valid()):
                    continue
                site = game.headers.get("Site", "")
                if site in old_sites:
                    continue
                trace = [move.uci() for move in game.mainline_moves()]
                signature = identity(game.board().fen(), trace)
                if signature in seen or len(trace) < 32:
                    continue
                seen.add(signature)
                options = windows(game, signature, old_boards)
                if not options:
                    continue
                valid += 1
                for stratum, row in options.items():
                    pools[stratum].append(dict(
                        row, event=event, group=group,
                        site=site if site.startswith("https://lichess.org/broadcast/") else metadata["broadcast"],
                    ))
        files.append(dict(metadata, sha256=sha256(source.read_bytes()).hexdigest(), eligibleGames=valid))
    picked = []
    picked_games = set()
    picked_boards = set()
    counts = Counter()
    # Fill the rarest cells first, then distribute each cell over event groups.
    for stratum, choices in sorted(pools.items(), key=lambda item: (len(item[1]), item[0])):
        event_uses = Counter()
        for _ in range(TARGET):
            available = (
                row for row in choices
                if row["game"] not in picked_games and counts[row["group"]] < GROUP_CAP
                and board_key(chess.Board(row["fen"])) not in picked_boards
            )
            pick = min(available, key=lambda row: (event_uses[row["group"]], counts[row["group"]], row["id"]),
                       default=None)
            if pick is None:
                break
            picked.append(dict(pick, id=pick["id"][:20]))
            picked_games.add(pick["game"])
            picked_boards.add(board_key(chess.Board(pick["fen"])))
            event_uses[pick["group"]] += 1
            counts[pick["group"]] += 1
    received = Counter((row["ratingBand"], row["phase"]) for row in picked)
    if len(picked) != len(RATINGS) * len(PHASES) * TARGET:
        raise ValueError(f"Insufficient eligible games for the frozen cells: {received}. "
                         f"Selected groups: {counts}. "
                         f"Pools: {[(key, Counter(row['group'] for row in rows)) for key, rows in pools.items()]}")
    return sorted(picked, key=lambda row: (row["group"], row["id"])), {
        "seed": SEED, "targetPerCell": TARGET, "groupCap": GROUP_CAP,
        "excludedInputs": receipts, "broadcasts": files,
        "scoredGroups": dict(counts), "ratingPhaseCounts": [
            {"rating": rating, "phase": phase, "cases": count}
            for (rating, phase), count in sorted(received.items())
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--prior", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    sample, manifest = select(read(args.sources), args.sources.parent, args.prior)
    write(args.output, sample)
    manifest["sampleSha256"] = sha256(args.output.read_bytes()).hexdigest()
    write(args.output.with_suffix(".manifest.json"), manifest)
    print(len(sample), f"games from {len(manifest['scoredGroups'])} event groups", flush=True)
