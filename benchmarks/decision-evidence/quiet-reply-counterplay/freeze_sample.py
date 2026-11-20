import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re

import chess
import chess.pgn

from quiet_screen import quiet_roles, threat_targets

SEED = "quiet-defence-counterattack-november-2026"


class QuietGameBuilder(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def read(path):
    return json.loads(path.read_bytes())


def ticket(*values):
    return sha256("|".join(map(str, values)).encode()).hexdigest()


def family(slug):
    year = re.search(r"[a-z].*?-(20\d\d)(?:-|$)", slug)
    return slug[:year.end(1)] if year else slug


def key(board):
    return min(board.epd(), board.mirror().epd())


def write(path, value):
    with path.open("x", encoding="utf8", newline="\n") as out:
        json.dump(value, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")


def samples(sources, excluded, base):
    games, seen, events = set(), set(), set()
    for old in excluded:
        seen.add(key(chess.Board(old["fen"])))
        history = old.get("history") or {}
        if len(history.get("moves", [])) >= 24:
            games.add(ticket(history["fen"], *history["moves"][:24]))
        if event := old.get("event"):
            events.add(family(event))
        if site := old.get("site") or old.get("sourceUrl"):
            if match := re.match(r"https://lichess\.org/broadcast/([^/]+)/", site):
                events.add(family(match[1]))
    pools = defaultdict(list)
    suffix = []
    for item in sources:
        if family(item["slug"]) in events:
            continue
        path = base / item["file"]
        if sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Invalid source hash.")
        with path.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=QuietGameBuilder)) is not None:
                if game.errors or game.headers.get("Result") not in {"1-0","1/2-1/2","0-1"}:
                    continue
                board = game.board()
                if board.chess960 or not board.is_valid():
                    continue
                fen = board.fen()
                moves = list(game.mainline_moves())
                trace = [move.uci() for move in moves]
                game_id = ticket(fen, *trace[:24])
                if game_id in games or len(moves) < 35:
                    continue
                games.add(game_id)
                chosen = {}
                for i, move in enumerate(moves):
                    if (24 <= i <= min(106, len(moves)-7) and board.halfmove_clock < 35
                            and len(board.piece_map()) >= 10 and not board.is_check()
                            and key(board) not in seen):
                        roles = {}
                        before = board.copy(stack=True)
                        before.push(move)
                        reply = moves[i+1]
                        for square in threat_targets(board, move):
                            role = quiet_roles(before, move, reply, square)
                            if role:
                                roles[chess.square_name(square)] = role
                        category = "attack-reply" if roles else "ordinary"
                        priority = ticket(SEED, game_id, i)
                        if category not in chosen or priority < chosen[category]["id"]:
                            site = game.headers.get("Site","")
                            chosen[category] = dict(
                                id=priority[:20], game=game_id, fen=board.fen(), category=category,
                                event=item["slug"], group=item["group"],
                                site=site if site.startswith("https://lichess.org/broadcast/") else item["broadcast"],
                                history=dict(fen=fen, moves=trace[:i]),
                                recordedRoot=trace[i], recordedReply=trace[i+1], roles=roles,
                            )
                    board.push(move)
                for category, case in chosen.items():
                    pools[(item["group"],category)].append(case)
        suffix.append(item)
    written = []
    picked = set()
    for category, cap, limit in (("attack-reply",12,80),("ordinary",5,48)):
        choice = []
        groups = sorted(g for g,c in pools if c == category)
        buckets = [[x for x in sorted(pools[(g, category)],key=lambda x:x["id"])] for g in groups]
        count = 0
        for index in range(max(map(len,buckets),default=0)):
            for bucket in buckets:
                if index >= len(bucket) or count >= limit:
                    continue
                row = bucket[index]
                if row["game"] in picked or key(chess.Board(row["fen"])) in seen:
                    continue
                if sum(x["group"]==row["group"] for x in choice) >= cap:
                    continue
                choice.append(row)
                picked.add(row["game"])
                seen.add(key(chess.Board(row["fen"])))
                count += 1
        written.extend(choice)
    return written,suffix


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("sources",type=Path)
    parser.add_argument("sample",type=Path)
    parser.add_argument("prior",type=Path,nargs="+")
    args = parser.parse_args()
    rows, sources = samples(read(args.sources), [x for p in args.prior for x in read(p)], args.sources.parent)
    write(args.sample,rows)
    write(args.sample.with_suffix(".manifest.json"),dict(
        seed=SEED,sha256=sha256(args.sample.read_bytes()).hexdigest(),sources=sources,
        exclusions=[dict(file=p.name,sha256=sha256(p.read_bytes()).hexdigest()) for p in args.prior],
        counts=dict(Counter(x["category"] for x in rows)),groups=dict(Counter(x["group"] for x in rows)),
    ))
    print(len(rows),dict(Counter(r["category"] for r in rows)), "groups",len({r["group"] for r in rows}),flush=True)
