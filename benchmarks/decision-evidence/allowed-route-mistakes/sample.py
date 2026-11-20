"""Freeze and search separate classical games using archived broadcast PGNs."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path

import chess.pgn
import chess.engine

from prepare import board_key, group, on_board, initial, read, searched


class BroadcastGame(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def family(site):
    return site.split("/")[4] if site.startswith("https://lichess.org/broadcast/") else ""


def standard_event(label, headers):
    if len(label) < 5 or any(token in label.split("-") for token in ("rapid", "blitz", "bullet", "freestyle", "armageddon")):
        return False
    control = headers.get("TimeControl", "").split("+")[0].split("/")[-1]
    return not control.isdecimal() or int(control) >= 3600


def choices(game, signature, site, used_boards):
    board = game.board()
    start = board.fen()
    nodes = list(game.mainline())
    history = []
    for ply, node in enumerate(nodes):
        if 30 <= ply < len(nodes) - 5 and ply < 140:
            before, after = node.parent.eval(), node.eval()
            if before is not None and after is not None:
                start_cp, end_cp = before.pov(board.turn).score(), after.pov(board.turn).score()
                if (start_cp is not None and end_cp is not None and abs(start_cp) <= 650
                    and abs(end_cp) <= 850 and start_cp - end_cp >= 140):
                    row = dict(fen=board.fen(), playedMoveUci=node.move.uci(), game=signature,
                               site=site, event=family(site), ply=ply,
                               previousAnnotatedLossCp=start_cp - end_cp,
                               history=dict(fen=start,moves=history[:]))
                    if board_key(row) not in used_boards and not board.can_claim_draw():
                        token = hashlib.sha256(f"causal-transfer-v1:{signature}:{ply}".encode()).hexdigest()[:16]
                        yield dict(row, id=f"causal-transfer-{token}", cohort="new-classical")
        history.append(node.move.uci())
        board.push(node.move)


def select(research, existing, quota):
    previous = [row for row in existing if row.get("playedMoveUci")]
    games = {group(row) for row in previous}
    # History is canonical even when an earlier sampler used a different site
    # label or game hash convention.
    histories = set()
    for row in previous:
        history = row.get("history")
        if history and len(history["moves"]) >= 24:
            histories.add((history["fen"], tuple(history["moves"][:24])))
    sites = {row["site"] for row in previous if row.get("site") and len(row["site"].split("/")) >= 8}
    used_boards = {board_key(row) for row in previous}
    seen = set()
    events = {family(row.get("site") or "") for row in previous}
    events.update(row.get("event") for row in previous)
    sources = {}
    pools = defaultdict(list)
    for file in sorted(research.rglob("*.pgn")):
        if file.stat().st_size > 4_000_000:
            continue
        with file.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=BroadcastGame)) is not None:
                if game.errors or game.headers.get("Result", "*") == "*":
                    continue
                site = game.headers.get("Site", "")
                label = family(site)
                if not standard_event(label, game.headers) or site in sites or label in events:
                    continue
                moves = tuple(move.uci() for move in game.mainline_moves())
                if len(moves) < 40 or game.board().uci_variant != "chess" or game.board().chess960:
                    continue
                identity = (game.board().fen(), moves[:24])
                signature = hashlib.sha256("\0".join((identity[0], *identity[1])).encode()).hexdigest()
                if signature[:16] in games or identity in histories or identity in seen:
                    continue
                seen.add(identity)
                options = list(choices(game, signature, site, used_boards))
                if options:
                    selected = min(options, key=lambda row: row["id"])
                    pools[label].append(selected)
                    sources[selected["id"]] = file
    rows = []
    for repeat in range(10):
        for event, group_rows in sorted(pools.items()):
            eligible = sorted(group_rows, key=lambda row: row["id"])
            if repeat >= len(eligible):
                continue
            row = eligible[repeat]
            canonical = board_key(row)
            if canonical not in used_boards and len(rows) < quota:
                rows.append(row)
                used_boards.add(canonical)
    return rows, {str(file.relative_to(research)): hashlib.sha256(file.read_bytes()).hexdigest()
                  for file in {sources[row["id"]] for row in rows}}


def analyse(task):
    row, exe, nodes = task
    board = initial(row)
    actual = row["playedMoveUci"]
    with chess.engine.SimpleEngine.popen_uci(exe) as engine:
        engine.configure({"Hash": 64, "Threads": 1})
        leading = on_board(searched(engine, board, 600_000), board)
        if not leading or leading[0]["pvUci"][0] == actual:
            return dict(row, candidates=leading, search="played-leads")
        best = leading[0]["pvUci"][0]
        matched = on_board(searched(engine, board, nodes, fixed=[best, actual]), board)
        if (len(matched) != 2 or matched[0]["pvUci"][0] != best
            or any(line["cp"] is None for line in matched) or matched[0]["cp"] - matched[1]["cp"] < 90):
            return dict(row, candidates=leading, comparisonCandidates=matched, search="no-finite-loss")
        replies = []
        for move in (best, actual):
            reached = board.copy()
            reached.push_uci(move)
            replies.append(dict(moveUci=move, lines=on_board(searched(engine, reached, nodes), reached)))
        return dict(row, candidates=leading, comparisonCandidates=matched, replyProbes=replies, search="compared")


def write(file, data):
    with file.open("x", encoding="utf-8") as stream:
        json.dump(data, stream, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="mode", required=True)
    freeze = subparsers.add_parser("freeze")
    for name in ("research", "existing", "output", "manifest"):
        freeze.add_argument(name, type=Path)
    freeze.add_argument("--quota", type=int, default=72)
    search = subparsers.add_parser("search")
    for name in ("sample", "engine", "output"):
        search.add_argument(name, type=Path)
    search.add_argument("--nodes", type=int, default=2_400_000)
    search.add_argument("--reuse", type=Path)
    args = parser.parse_args()
    if args.mode == "freeze":
        rows, sources = select(args.research, read(args.existing), args.quota)
        write(args.manifest, dict(sources=sources, events=Counter(row["event"] for row in rows)))
    else:
        frozen = read(args.sample)
        reused = {row["id"]: row for row in read(args.reuse)} if args.reuse else {}
        for row in frozen:
            if row["id"] in reused and any(row[key] != reused[row["id"]][key] for key in ("fen", "playedMoveUci", "history")):
                raise ValueError("Saved search points to a different game position")
        tasks = [(row, str(args.engine), args.nodes) for row in frozen if row["id"] not in reused]
        with ProcessPoolExecutor(max_workers=6) as pool:
            reused.update((row["id"], row) for row in pool.map(analyse, tasks))
        rows = [reused[row["id"]] for row in frozen]
        print(dict(Counter(row["search"] for row in rows)))
    write(args.output, rows)
    print(len(rows), "requests")


if __name__ == "__main__":
    main()
