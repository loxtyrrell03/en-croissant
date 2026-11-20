"""Select unseen, public classical boards with an immediately loose pawn."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

import chess
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "competing-pawn-plans"))
from gather_plans import Broadcast, canonical, identify


def read(path):
    return json.loads(path.read_bytes())


def deferred(board, candidate, moves):
    """Recorded games nominate a shape only. They are not the reference."""
    position = board.copy(stack=False)
    for move in moves[:10]:
        if move == candidate and not position.is_check() and not position.gives_check(move):
            return not position.attackers(not position.turn, move.to_square)
        if (move.from_square in (candidate.from_square, candidate.to_square) or
                move.to_square == candidate.to_square):
            return False
        position.push(move)
    return False


def nominees(game, blocked_games, blocked_boards):
    initial = game.board()
    moves = list(game.mainline_moves())
    game_id = identify(initial, [move.uci() for move in moves])
    if game_id in blocked_games:
        return
    if (game.errors or initial.chess960 or not initial.is_valid() or
            game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}):
        return
    url = game.headers.get("Site", "")
    route = re.fullmatch(r"https://lichess\.org/broadcast/([^/]+)/(?:[^/]+/){2}[A-Za-z0-9]{8}", url)
    if not route:
        return
    group = re.sub(r"(?:-open-section|-open|-women|-section-[a-z]|-masters)$", "", route[1])
    pos = initial.copy(stack=False)
    for ply, played in enumerate(moves[:110]):
        if (26 <= ply <= len(moves) - 4 and not pos.is_check() and
                8 <= pos.occupied.bit_count() <= 24 and (key := canonical(pos)) not in blocked_boards):
            captures = []
            for move in pos.generate_legal_captures(to_mask=int(pos.pieces(chess.PAWN, not pos.turn))):
                if (not move.promotion and not pos.gives_check(move) and
                        not pos.attackers(not pos.turn, move.to_square)):
                    captures.append(move)
            for capture in captures:
                category = "taken" if played == capture else "deferred" if deferred(pos, capture, moves[ply:]) else None
                if category is None:
                    continue
                identity = sha256(f"defer-pawn-v1:{game_id}:{ply}:{capture.uci()}".encode()).hexdigest()[:16]
                yield dict(id=identity, game=game_id, event=group, group=group, site=url,
                           fen=pos.fen(), playedMoveUci=played.uci(), nominatedCapture=capture.uci(),
                           history=dict(fen=initial.fen(), moves=[m.uci() for m in moves[:ply]]),
                           stratum=category, boardKey=key)
        pos.push(played)


def expected_rows(path):
    saved = read(path)
    return saved if isinstance(saved, list) else [
        item for rows in saved.values() if isinstance(rows, list) for item in rows
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sources", type=Path, nargs="+", required=True)
    parser.add_argument("--exclusions", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    blocked_games, blocked_boards = set(), set()
    for path in args.exclusions:
        for row in expected_rows(path):
            if fen := row.get("fen"):
                blocked_boards.add(canonical(chess.Board(fen)))
            if (history := row.get("history")) and len(history["moves"]) >= 24:
                blocked_games.add(identify(chess.Board(history["fen"]), history["moves"]))
    candidates, manifest = [], {}
    for path in args.sources:
        added = []
        with path.open(encoding="utf-8-sig") as stream:
            while (game := chess.pgn.read_game(stream, Visitor=Broadcast)) is not None:
                added.extend(nominees(game, blocked_games, blocked_boards))
        candidates.extend(added)
        manifest[path.name] = dict(sha256=sha256(path.read_bytes()).hexdigest(),
                                   candidates=dict(Counter(row["stratum"] for row in added)))
    selected = []
    for stratum in ("deferred", "taken"):
        groups = Counter()
        for row in sorted((r for r in candidates if r["stratum"] == stratum), key=lambda r: r["id"]):
            if (row["game"] in blocked_games or row["boardKey"] in blocked_boards or groups[row["event"]] >= 4):
                continue
            groups[row["event"]] += 1
            blocked_games.add(row["game"])
            blocked_boards.add(row.pop("boardKey"))
            selected.append(row)
            if sum(groups.values()) >= 32:
                break
    for path, payload in ((args.output, selected),
                          (args.output.with_suffix(".manifest.json"), dict(
                              counts=dict(Counter(row["stratum"] for row in selected)),
                              groups=sorted({row["event"] for row in selected}), sources=manifest,
                              excluded={path.name:sha256(path.read_bytes()).hexdigest() for path in args.exclusions},
                          ))):
        with path.open("x", encoding="utf8", newline="\n") as out:
            json.dump(payload, out, indent=2)
            out.write("\n")
    print(len(selected), dict(Counter(row["stratum"] for row in selected)), flush=True)


if __name__ == "__main__":
    main()
