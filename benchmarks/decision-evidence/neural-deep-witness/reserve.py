"""Freeze a second classical cohort enriched using the broadcaster's scores."""
from collections import defaultdict
from hashlib import sha256
from io import StringIO
from pathlib import Path
from urllib.request import urlopen
import argparse
import json
import re

import chess
import chess.pgn

from frames import family, game_key, key, records, write
from sample import board_key

TOURS = (
    "1ts5JuHv", "JkAJY6gT", "Tf2HPVdZ", "E2Ux0N0V", "rP1d4Wv7", "4jZflFpE",
    "7Mp0YNJB", "7sIlRA7Q", "9eVM8WKe", "WENBxvoS", "dlKwJPL0", "kpCb2J5c",
    "ZPONzjmY", "q9ysPINd", "OeslJUKC", "yVOLKime", "kRFjynRr",
)


def fetch(url, limit=1_500_000):
    with urlopen(url, timeout=15) as response:
        raw = response.read(limit+1)
    if len(raw) > limit:
        raise ValueError("Broadcast response exceeds the bounded sample size")
    return raw


def options(game, signature, slug, site, excluded):
    board = game.board()
    uci = []
    scored = []
    nodes = list(game.mainline())
    for ply, node in enumerate(nodes):
        if 30 <= ply < len(nodes) - 4 and not board.is_game_over(claim_draw=True):
            a, b = node.parent.eval(), node.eval()
            if a is not None and b is not None and not a.is_mate() and not b.is_mate():
                old, new = a.pov(board.turn).score(), b.pov(board.turn).score()
                loss = old-new
                position = board_key(board)
                if loss >= 140 and abs(old) <= 650 and abs(new) <= 850 and position not in excluded:
                    group = "large" if loss >= 275 else "moderate"
                    token = key("deep-witness-reserve-v1", signature, ply)
                    scored.append(dict(
                        id="deeper-loss-"+token[:16], event=slug, game=signature, site=site,
                        fen=board.fen(), playedMoveUci=node.move.uci(), ply=ply, stratum=group,
                        previousAnnotatedLossCp=loss, history=dict(fen=game.board().fen(), moves=uci[:]),
                    ))
        uci.append(node.move.uci())
        board.push(node.move)
    preferred = "large" if int(signature[:2], 16) < 128 else "moderate"
    return min(scored, key=lambda r: (r["stratum"] != preferred, r["id"]), default=None)


def run(train, primary, output, manifest):
    sources = [r for file in (train, primary) for r in records(file)]
    used_events = {family(r["event"]) for r in sources}
    games = {game_key(r) for r in sources}
    used_boards = {board_key(chess.Board(r["fen"])) for r in sources}
    pool = defaultdict(list)
    receipts = []
    for tour in TOURS:
        payload = json.loads(fetch(f"https://lichess.org/api/broadcast/{tour}"))
        metadata = payload["tour"]
        slug = metadata["slug"]
        cluster = family(slug)
        time = metadata["info"].get("tc", "")
        if cluster in used_events or not re.match(r"(?:[6-9]\d|1\d\d)\s*(?:min|')", time):
            continue
        rounds = sorted((r for r in payload["rounds"] if r.get("finished")), key=lambda r: key("reserve-round", r["id"]))
        for rnd in rounds[:4]:
            url = f"https://lichess.org/api/broadcast/round/{rnd['id']}.pgn?clocks=false"
            raw = fetch(url)
            receipts.append(dict(event=slug, round=rnd["id"], url=url, sha256=sha256(raw).hexdigest(), timeControl=time))
            with StringIO(raw.decode("utf-8-sig", errors="replace")) as stream:
                while (game := chess.pgn.read_game(stream)) is not None:
                    if game.errors or game.headers.get("Result", "*") == "*":
                        continue
                    moves = [m.uci() for m in game.mainline_moves()]
                    if len(moves) < 45:
                        continue
                    signature = key(game.board().fen(), *moves[:24])
                    if signature not in games:
                        chosen = options(game, signature, slug, rnd["url"], used_boards)
                        if chosen:
                            pool[cluster].append(chosen)
                            games.add(signature)
        print(slug, len(pool[cluster]), "eligible games", flush=True)
    output_rows = []
    for cluster, eligible in sorted(pool.items()):
        for row in sorted(eligible, key=lambda r: r["id"]):
            if len([r for r in output_rows if family(r["event"]) == cluster]) >= 12:
                break
            b = board_key(chess.Board(row["fen"]))
            if b not in used_boards:
                used_boards.add(b)
                output_rows.append(row)
    write(output, output_rows)
    write(manifest, receipts)
    print(len(output_rows), "games frozen across", len({r["event"] for r in output_rows}), "events", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("train", "primary", "output", "manifest"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    run(args.train, args.primary, args.output, args.manifest)
