"""Select one annotated classical choice per game before running either classifier."""

import argparse
from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re

import chess.pgn


SEED = b"candidates-annotated-move-audit-2026"
TACTICAL = re.compile(
    r"tactic|counterplay|threat|fork|deflect|sacrific|pin(?:s|ned|ning)?\b|insufficien|"
    r"trap|forced|mate|attack on|win(?:s|ning)? (?:a|the|material)|hang|only move|intermediate", re.I
)
STRATEGIC = re.compile(
    r"file\b|diagonal|pawn structure|weak square|weak pawn|outpost|king safety|"
    r"compensation|piece activity|space|queenside|kingside|cent(?:er|re|ral)|"
    r"minor piece|blockad|pass(?:er|ed pawn)|restrain|break|long.term|formation", re.I
)
MISTAKE = re.compile(r"mistak|blunder|inaccura|should have|was stronger|was better|"
                     r"could have (?:kept|played|saved|defend)|miss(?:ed|es) the", re.I)
SPLITS = {"open": "development", "women": "reserve"}


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def identity(*parts):
    return sha256(SEED + b"\0" + "\0".join(parts).encode()).hexdigest()[:20]


def write(path, data):
    with path.open("x", encoding="utf8", newline="\n") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def classify(comment, nags):
    if MISTAKE.search(comment) or nags & {2, 4, 6}:
        return "mistakeSignal"
    tactical, strategic = bool(TACTICAL.search(comment)), bool(STRATEGIC.search(comment))
    if tactical and strategic:
        return "bothSignals"
    if tactical:
        return "tacticalSignal"
    if strategic:
        return "strategicSignal"
    return "other"


def collect(pgn, excluded):
    used_positions = {board_key(chess.Board(row["fen"])) for row in excluded}
    previous_prefixes = set()
    for row in excluded:
        history = row.get("history")
        if history and len(history["moves"]) >= 24:
            previous_prefixes.add(tuple(history["moves"][:24]))
    pools = defaultdict(dict)
    notes = {}
    with pgn.open(encoding="utf-8-sig") as stream:
        while game := chess.pgn.read_game(stream):
            if game.errors or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
                continue
            phase = "women" if "women" in game.headers.get("Event", "").lower() else "open"
            site = game.headers["ChapterURL"]
            if tuple(move.uci() for move in list(game.mainline_moves())[:24]) in previous_prefixes:
                continue
            start = game.board()
            board = start.copy()
            moves = []
            for node in game.mainline():
                comment = re.sub(r"\[%[^\]]+\]", "", node.comment).strip()
                if 16 <= len(moves) <= 109 and len(comment.split()) >= 12:
                    key = board_key(board)
                    if key not in used_positions and not board.is_game_over():
                        cohort = classify(comment, node.nags)
                        mark = identity(site, str(len(moves)), node.move.uci())
                        row = dict(id=mark, game=site.rsplit("/", 1)[1], site=site, group=phase,
                                   split=SPLITS[phase], phase="opening" if len(moves) < 24 else
                                   "middlegame" if len(moves) < 70 else "late game",
                                   stratum=cohort, fen=board.fen(), playedMoveUci=node.move.uci(),
                                   ply=len(moves)+1, history=dict(fen=start.fen(), moves=moves[:]))
                        pools[phase].setdefault(row["game"], []).append(row)
                        notes[mark] = comment
                board.push(node.move)
                moves.append(node.move.uci())
    return pools, notes, used_positions


def choose(pools, used):
    rows = []
    order = ("mistakeSignal", "bothSignals", "strategicSignal", "tacticalSignal", "other")
    for phase in SPLITS:
        remaining = pools[phase].copy()
        while remaining:
            prior_size = len(remaining)
            for cohort in order:
                options = [row for game in remaining.values() for row in game
                           if row["stratum"] == cohort and board_key(chess.Board(row["fen"])) not in used]
                if options:
                    row = min(options, key=lambda item: item["id"])
                    rows.append(row)
                    remaining.pop(row["game"])
                    used.add(board_key(chess.Board(row["fen"])))
            if prior_size == len(remaining):
                break
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("pgn", "output", "notes"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--exclude", nargs="+", type=Path, required=True)
    args = parser.parse_args()
    excluded = []
    for path in args.exclude:
        value = json.loads(path.read_bytes())
        excluded.extend(value["reserve"] if isinstance(value, dict) else value)
    pools, notes, used = collect(args.pgn, excluded)
    rows = choose(pools, used)
    write(args.output, rows)
    write(args.notes, {row["id"]: notes[row["id"]] for row in rows})
    write(args.output.with_suffix(".manifest.json"), dict(
        pgnSha256=digest(args.pgn), selectionSha256=digest(args.output),
        source="https://lichess.org/study/Y1yXP80U",
        exclusions={path.name: digest(path) for path in args.exclude},
        sampled=len(rows), counts={part: dict(Counter(row["stratum"] for row in rows if row["split"] == part))
                                  for part in SPLITS.values()},
    ))
    print(len(rows), Counter(row["split"] for row in rows), Counter(row["stratum"] for row in rows), flush=True)


if __name__ == "__main__":
    main()
