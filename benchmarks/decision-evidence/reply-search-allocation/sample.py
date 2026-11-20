"""Freeze one classical decision per game before opening reply results."""
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import argparse
import json
import re

import chess
import chess.pgn

SEED = "en-croissant-reply-budget-e389632b"
N = 300


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def classical_sources(work):
    sources = {}
    for manifest in sorted(work.rglob("public-sources.json")):
        directory = manifest.parent / "raw"
        if not directory.is_dir():
            continue
        for key, event in json.loads(manifest.read_bytes()).items():
            if not isinstance(event, dict) or not event.get("broadcast") or not event.get("rounds"):
                continue
            time = re.search(r"(\d+)\s*(min\b|minutes\b|mins\b|m\b)", event.get("tc", "").lower())
            if not time or int(time.group(1)) < 60:
                continue
            slug = event["broadcast"].strip("/").split("/")[0]
            for rnd in event["rounds"]:
                file = directory / f"{key}-{rnd['id']}.pgn"
                if file.is_file():
                    sources[file] = slug, f"https://lichess.org/broadcast/{slug}/round/{rnd['id']}"
    return sources


def preview_game(game, key, event, fallback_site):
    board = game.board()
    history = []
    eligible = []
    nodes = list(game.mainline())
    for ply, node in enumerate(nodes):
        if 32 <= ply < len(nodes)-5 and not board.is_game_over(claim_draw=True):
            old, new = node.parent.eval(), node.eval()
            loss = None
            if old is not None and new is not None:
                old_cp = old.pov(board.turn).score(mate_score=5000)
                new_cp = new.pov(board.turn).score(mate_score=5000)
                loss = old_cp - new_cp
            # Keep games with clear reported losses and a smaller ordinary control stratum.
            stratum = "reported-loss" if loss is not None and loss >= 95 else "ordinary"
            identity = sha256(f"{SEED}:{key}:{ply}".encode()).hexdigest()
            eligible.append((stratum, identity, ply, board.fen(), node.move.uci(), loss))
        history.append(node.move.uci())
        board.push(node.move)
    if not eligible:
        return None
    choose_loss = int(key[:2], 16) < 190
    stratum, identity, ply, fen, move, loss = min(
        eligible, key=lambda item: (choose_loss and item[0] != "reported-loss", item[1])
    )
    site = game.headers.get("Site", "")
    return {
        "id": f"reply-budget-{identity[:16]}", "game": key, "fen": fen, "playedMoveUci": move,
        "event": event, "site": site if site.startswith("https://lichess.org/broadcast/") else fallback_site,
        "ply": ply, "stratum": stratum, "previousAnnotatedLossCp": loss,
        "history": {"fen": game.board().fen(), "moves": history[:ply]},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("exclude", type=Path, nargs="+")
    args = parser.parse_args()
    excluded = [row for file in args.exclude for row in json.loads(file.read_bytes())]
    old_positions = {board_key(chess.Board(row["fen"])) for row in excluded}
    old_sites = {row["site"] for row in excluded if row.get("site")}
    old_events = {row["event"] for row in excluded if row.get("event")}
    selected = defaultdict(list)
    seen = set()
    sources = classical_sources(args.work)
    for file, (event, site) in sorted(sources.items()):
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*" or not game.headers.get("White"):
                    continue
                if game.headers.get("Site") in old_sites:
                    continue
                moves = [node.move.uci() for node in game.mainline()]
                if len(moves) < 44:
                    continue
                key = sha256(" ".join([event, *moves[:35]]).encode()).hexdigest()
                if key in seen:
                    continue
                seen.add(key)
                board = game.board()
                for ply, move in enumerate(moves):
                    if ply >= 27 and board_key(board) in old_positions:
                        break
                    board.push_uci(move)
                else:
                    row = preview_game(game, key, event, site)
                    if row:
                        selected[event].append(row)
    # Take an equal number per event when possible. Previously unused events get the odd remainder.
    sample = []
    index = 0
    while len(sample) < N:
        for event, pool in sorted(selected.items(), key=lambda pair: (pair[0] in old_events, pair[0])):
            if index == 0:
                pool.sort(key=lambda row: row["id"])
            if len(pool) > index:
                sample.append(pool[index])
                if len(sample) == N:
                    break
        if not any(len(pool) > index for pool in selected.values()):
            break
        index += 1
    with args.output.open("x", encoding="utf-8") as f:
        json.dump(sample, f, separators=(",", ":"))
    print(f"{len(sample)} positions from {len(sources)} public PGNs, {len(selected)} events", flush=True)


if __name__ == "__main__":
    main()
