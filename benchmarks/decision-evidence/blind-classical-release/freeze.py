"""Freeze a new, phase-balanced release benchmark without seeing engine scores."""
import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

import chess
import chess.pgn

audit = Path(__file__).resolve().parents[1] / "current-classifier-audit"
sys.path.insert(0, str(audit))
spec = importlib.util.spec_from_file_location("classical_source", audit / "freeze-classical.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from freeze import Broadcast, board_key, identity

SEED = "release-blind-classical-v66"
PER_PHASE = 12
MAX_EVENT = 6


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def nominate(source, blocked_games, blocked_boards):
    start = source.board()
    played = list(source.mainline_moves())
    uci = [move.uci() for move in played]
    game_id = identity(start.fen(), uci)
    if game_id in blocked_games or len(uci) < 32:
        return []
    rows = module.windows(source, game_id, blocked_boards)
    return [
        dict(row, id=identity(SEED, [game_id, str(row["ply"])]), game=game_id)
        for row in rows.values()
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--prior", type=Path, nargs="+", required=True)
    args = parser.parse_args()

    blocked_games, blocked_boards, known_sites = set(), set(), set()
    for path in args.prior:
        for item in read(path):
            if "fen" in item:
                blocked_boards.add(board_key(chess.Board(item["fen"])))
            if item.get("site"):
                known_sites.add(item["site"])
            history = item.get("history") or {}
            if len(history.get("moves", ())) >= 24:
                blocked_games.add(identity(history["fen"], history["moves"]))
    pools = defaultdict(list)
    sources = read(args.sources)
    for meta in sources:
        path = args.sources.parent / meta["file"]
        if digest(path) != meta["sha256"]:
            raise ValueError(f"PGN hash mismatch for {meta['slug']}")
        with path.open(encoding="utf-8-sig") as buffer:
            while (game := chess.pgn.read_game(buffer, Visitor=Broadcast)) is not None:
                if (game.errors or game.board().chess960 or not game.board().is_valid() or
                        game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}):
                    continue
                site = game.headers.get("Site")
                if not site or site in known_sites or not site.startswith("https://lichess.org/broadcast/"):
                    continue
                for row in nominate(game, blocked_games, blocked_boards):
                    pools[row["phase"]].append(dict(row, event=meta["slug"], group=meta["group"], site=site))
    if set(pools) != set(module.PHASES):
        raise ValueError("Missing one of the three classical decision windows")

    chosen, groups, ratings = [], Counter(), Counter()
    for phase, rows in sorted(pools.items(), key=lambda kv: (len(kv[1]), kv[0])):
        within_phase = Counter()
        for _ in range(PER_PHASE):
            options = (row for row in rows if row["game"] not in blocked_games and
                       row["site"] not in known_sites and groups[row["group"]] < MAX_EVENT and
                       board_key(chess.Board(row["fen"])) not in blocked_boards)
            item = min(options, key=lambda row: (within_phase[row["group"]], ratings[row["ratingBand"]],
                                                groups[row["group"]], row["id"]), default=None)
            if not item:
                raise ValueError(f"Insufficient games for {phase}")
            chosen.append(dict(item, id=item["id"][:20]))
            blocked_games.add(item["game"])
            blocked_boards.add(board_key(chess.Board(item["fen"])))
            known_sites.add(item["site"])
            groups[item["group"]] += 1
            within_phase[item["group"]] += 1
            ratings[item["ratingBand"]] += 1
    module.write(args.output, sorted(chosen, key=lambda row: (row["group"], row["id"])))
    module.write(args.output.with_suffix(".manifest.json"), dict(
        selectionSha256=digest(args.output), sources=sources, groups=dict(groups), ratings=dict(ratings),
        perPhase=PER_PHASE, capPerGroup=MAX_EVENT, seed=SEED,
        sourcesExcluded={path.name:digest(path) for path in args.prior},
    ))
    print(len(chosen), "games", len(groups), "event groups", dict(ratings), flush=True)


if __name__ == "__main__":
    main()
