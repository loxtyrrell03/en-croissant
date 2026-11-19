"""Stream fresh fork localization cases without accessing model predictions."""

import argparse
from collections import Counter
import csv
import hashlib
import importlib
import io
import json
from pathlib import Path
import urllib.request

import chess
import zstandard

corpus = importlib.import_module("decision-evidence-motif-corpus")
public = corpus.public
QUOTA = 10
STRATA = ("root-tagged", "root-untagged", "later-tagged", "checking-control")


def fork_geometry(board, move):
    """A sampling cue. This deliberately does not prove profitable threats."""
    actor = board.turn
    before = board.attacks(move.from_square)
    board.push(move)
    targets = [square for square in board.attacks(move.to_square) if board.color_at(square) == (not actor)
               and board.piece_type_at(square) != chess.PAWN]
    return len(targets) >= 2 and any(square not in before for square in targets)


def root_and_later(board, line):
    state = board.copy(stack=False)
    found = [fork_geometry(state, state.parse_uci(uci)) for uci in line[:9]]
    return found[0], any(found[2::2])


def collect(response, training, extra):
    rows, counts = [], Counter()
    games = {row["game"] for row in training["cases"]}
    boards = {corpus.board_identity(chess.Board(row["fen"])) for row in training["cases"]}
    for cases in extra.values():
        games.update(row["game"] for row in cases)
        boards.update(corpus.board_identity(chess.Board(row["fen"])) for row in cases)
    with zstandard.ZstdDecompressor().stream_reader(response) as reader:
        stream = csv.DictReader(io.TextIOWrapper(reader, encoding="utf-8"))
        for scanned, row in enumerate(stream, 1):
            if scanned <= training["rowsScanned"]:
                continue
            if scanned > training["rowsScanned"] + 250_000:
                raise ValueError(f"Reached the audit's scan limit with {dict(counts)}")
            if int(row["Popularity"]) < 80 or int(row["NbPlays"]) < 100:
                continue
            game = public.source_game_id(row["GameUrl"])
            if game in games or hashlib.sha256(("fork-audit-v1:" + game).encode()).digest()[0] >= 32:
                continue
            tagged = "fork" in row["Themes"].split()
            try:
                board, moves = corpus.solution(row)
                root, later = root_and_later(board, moves)
            except ValueError:
                continue
            if root:
                stratum = "root-tagged" if tagged else "root-untagged"
            elif tagged and later:
                stratum = "later-tagged"
            elif not tagged and not later and board.gives_check(board.parse_uci(moves[0])):
                stratum = "checking-control"
            else:
                continue
            key = corpus.board_identity(board)
            if key in boards or counts[stratum] == QUOTA:
                continue
            boards.add(key)
            games.add(game)
            counts[stratum] += 1
            rows.append(dict(id="lichess-" + row["PuzzleId"], game=game, fen=board.fen(), line=moves,
                             stratum=stratum, rootGeometry=root, laterGeometry=later))
            if len(rows) == QUOTA * len(STRATA):
                return scanned, rows
    raise ValueError("Could not fill the audit strata")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("training", type=Path)
    parser.add_argument("prior_transfer", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    training = json.loads(args.training.read_bytes())
    extra = json.loads(args.prior_transfer.read_bytes())
    request = urllib.request.Request(public.URL, headers={"User-Agent": "EnCroissant-local-research"})
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.headers["ETag"] != training["sourceHeaders"]["ETag"]:
            raise ValueError("Audit and training should use the same immutable source snapshot")
        scanned, rows = collect(response, training, extra)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(dict(source=public.URL, rowsScanned=scanned, cases=rows), output, indent=2)


if __name__ == "__main__":
    main()
