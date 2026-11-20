"""Independently check the exact outcome of legal moves in public endings."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import chess

from probe import initial

TABLEBASE = "https://tablebase.lichess.ovh/standard"
OUTCOME = {
    "win": 1, "draw": 0, "loss": -1, "blessed-loss": 0, "cursed-win": 0,
}


def from_table(position):
    url = TABLEBASE + "?" + urlencode({"fen": position.fen()})
    request = Request(url, headers={"User-Agent": "En-Croissant-Decision-Evidence-benchmark"})
    with urlopen(request, timeout=15) as response:
        data = json.load(response)
    moves = {m["uci"]: -OUTCOME[m["category"]] for m in data["moves"] if m["category"] in OUTCOME}
    outcome = OUTCOME.get(data["category"])
    if (
        outcome is None or set(moves) != {move.uci() for move in position.legal_moves}
        or max(moves.values(), default=outcome) != outcome
    ):
        return None, {}
    return outcome, moves


def eligible(board):
    return (
        sum(1 for _ in board.piece_map()) <= 7
        and not board.castling_rights and not board.is_game_over(claim_draw=True)
        and not board.is_repetition(2)
    )


def score(inputs, cache):
    result, seen = [], set()
    for row in inputs:
        site = row.get("site") or ""
        if not site.startswith("https://lichess.org/broadcast/"):
            continue
        board = initial(row)
        if board.fen() in seen or not eligible(board):
            continue
        seen.add(board.fen())
        if board.fen() not in cache:
            try:
                cache[board.fen()] = from_table(board)
            except (URLError, TimeoutError) as error:
                print(row["id"], type(error).__name__, flush=True)
                cache[board.fen()] = (None, {})
        outcome, moves = cache[board.fen()]
        played = row.get("playedMoveUci") or row.get("recordedMove")
        result.append({
            "id": row["id"], "fen": board.fen(), "site": site,
            "bestOutcome": outcome, "moves": moves,
            "played": played, "playedOutcome": moves.get(played),
            "engineChoices": [line["pvUci"][0] for line in row["candidates"] if line["pvUci"]],
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("input", type=Path, nargs="+")
    args = parser.parse_args()
    cache, results = {}, {}
    for path in args.input:
        data = path.read_bytes()
        rows = score(json.loads(data), cache)
        results[path.name] = {"sha256": sha256(data).hexdigest(), "positions": rows}
        print(path.name, Counter((row["bestOutcome"], sum(
            value == row["bestOutcome"] for value in row["moves"].values())) for row in rows), flush=True)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(results, file, indent=2)


if __name__ == "__main__":
    main()
