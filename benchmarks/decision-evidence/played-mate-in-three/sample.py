"""Freeze public games by event, game and board before searching new mates."""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

import chess
import chess.pgn


def digest(payload):
    return sha256(payload.encode() if isinstance(payload, str) else payload).hexdigest()


def key(board):
    return min(board.epd(), board.mirror().epd())


def game_key(fen, moves):
    return digest("|".join((fen, *moves[:24])))


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def family(game):
    site = game.headers.get("Site", "").split("/")
    if len(site) > 5 and site[3] == "broadcast":
        return site[4]
    return None


def cut(before, after):
    old_mate, new_mate = before.mate(), after.mate()
    if new_mate in (-3, -4):
        if old_mate is None or old_mate > 0:
            return "new-short"
        return "existing-mate"
    if new_mate is not None and -8 <= new_mate <= -5 and (old_mate is None or old_mate > 0):
        return "new-longer"
    if new_mate in (-1, -2) and (old_mate is None or old_mate > 0):
        return "immediate"
    if new_mate is None and old_mate is None and before.score() - after.score() >= 190 and after.score() <= -270:
        return "finite-loss"
    return None


def collect(root, exclusions):
    games, boards = set(), set()
    for path in exclusions:
        for case in json.loads(path.read_bytes()):
            boards.add(key(chess.Board(case["fen"])))
            h = case.get("history")
            if h and len(h["moves"]) >= 24:
                games.add(game_key(h["fen"], h["moves"]))
    seen_files, pool, files = set(), [], {}
    for path in sorted(root.rglob("*.pgn")):
        if path.stat().st_size > 3_000_000:
            continue
        raw = path.read_bytes()
        if b"[%eval" not in raw or not re.search(rb"\[%eval #-?[3456]\]", raw):
            continue
        token = digest(raw)
        if token in seen_files:
            continue
        seen_files.add(token)
        file = path.relative_to(root).as_posix()
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Broadcast)) is not None:
                event = family(game)
                if not event or re.search(r"blitz|rapid|bullet|armageddon", event, re.I) or game.errors:
                    continue
                if game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
                    continue
                control = game.headers.get("TimeControl", "").split("+")[0]
                if control.isdigit() and int(control) < 3600:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                fen = board.fen()
                moves = [node.move.uci() for node in game.mainline()]
                game_hash = game_key(fen, moves)
                if game_hash in games:
                    continue
                for index, node in enumerate(game.mainline()):
                    old, new = node.parent.eval(), node.eval()
                    if index >= 25 and old is not None and new is not None and key(board) not in boards:
                        stratum = cut(old.pov(board.turn), new.pov(board.turn))
                        if stratum:
                            pool.append({
                                "id": digest(f"mate-three-v1:{game_hash}:{index}")[:16],
                                "fen": board.fen(),
                                "history": {"fen": fen, "moves": moves[:index]},
                                "game": game_hash,
                                "playedMoveUci": node.move.uci(),
                                "site": game.headers["Site"],
                                "event": event,
                                "file": file,
                                "stratum": stratum,
                            })
                            files[file] = token
                    board.push(node.move)
    return pool, files, games, boards


def freeze(root, output, exclusions):
    pool, files, games, boards = collect(root, exclusions)
    print("Population", Counter(row["stratum"] for row in pool), flush=True)
    def split(event):
        return "development" if int(digest("mate-three-event-v1:"+event)[:4], 16) % 4 == 0 else "reserve"

    strata = {"new-short": (16, 36), "existing-mate": (10, 18), "new-longer": (6, 14),
              "finite-loss": (8, 22), "immediate": (8, 14)}
    manifest = {}
    for name, group in (("development", 0), ("reserve", 1)):
        counts, events, selected = Counter(), Counter(), []
        for stratum, budgets in strata.items():
            for row in sorted(pool, key=lambda value: value["id"]):
                if counts[stratum] >= budgets[group]:
                    break
                if row["stratum"] != stratum or split(row["event"]) != name:
                    continue
                event_key = (row["event"], stratum)
                square = key(chess.Board(row["fen"]))
                if square in boards or row["game"] in games or events[event_key] >= 4:
                    continue
                rowsource = row["file"]
                games.add(row["game"])
                boards.add(square)
                selected.append(row)
                events[event_key] += 1
                counts[stratum] += 1
                manifest[rowsource] = files[rowsource]
        with (output / f"{name}.json").open("x", encoding="utf-8") as stream:
            json.dump(selected, stream, separators=(",", ":"))
        print(name, counts, len({row["event"] for row in selected}), flush=True)
    with (output / "manifest.json").open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)


if __name__ == "__main__":
    source, output, *exclusions = map(Path, sys.argv[1:])
    freeze(source, output, exclusions)
