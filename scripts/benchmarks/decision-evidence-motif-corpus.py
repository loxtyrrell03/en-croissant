"""Stream a bounded CC0 puzzle sample for learning motif nominations.

The source tags describe a solution as a whole. Their absence is unlabelled
for human evaluation. Training uses it as a noisy negative.
"""

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

public = importlib.import_module("decision-evidence-public")
THEMES = tuple(public.THEMES[:11])
QUOTAS = {"train": 900, "validation": 120, "test": 120}
DOMAIN = b"en-croissant-motif-transfer-v1:"


def board_identity(board):
    return min(" ".join(position.fen().split()[:4]) for position in (board, board.mirror()))


def partition(game):
    bucket = int.from_bytes(hashlib.sha256(DOMAIN + game.encode()).digest()[:4], "big") % 100
    if bucket < 80:
        return "train"
    return "validation" if bucket < 90 else "test"


def solution(row):
    board = chess.Board(row["FEN"])
    moves = row["Moves"].split()
    if not board.is_valid() or len(moves) < 2:
        raise ValueError("No legal solution to sample")
    board.push_uci(moves[0])
    start = board.copy(stack=False)
    for move in moves[1:]:
        board.push_uci(move)
    return start, moves[1:]


def collect(response, excluded_games, excluded_boards, scan_limit):
    games = set(excluded_games)
    boards = set(excluded_boards)
    counts = Counter()
    rows = []
    with zstandard.ZstdDecompressor().stream_reader(response) as reader:
        stream = csv.DictReader(io.TextIOWrapper(reader, encoding="utf-8"))
        for scanned, row in enumerate(stream, 1):
            if scanned > scan_limit:
                scanned = scan_limit
                break
            positives = sorted(set(row["Themes"].split()).intersection(THEMES))
            strata = positives or ["other"]
            if int(row["Popularity"]) < 80 or int(row["NbPlays"]) < 100:
                continue
            game = public.source_game_id(row["GameUrl"])
            split = partition(game)
            bucket = min(strata, key=lambda theme: counts[split, theme])
            if counts[split, bucket] == QUOTAS[split] or game in games:
                continue
            try:
                board, moves = solution(row)
            except ValueError:
                continue
            key = board_identity(board)
            if key in boards:
                continue
            counts[split, bucket] += 1
            games.add(game)
            boards.add(key)
            rows.append(dict(id=row["PuzzleId"], game=game, split=split, fen=board.fen(),
                             line=moves, tags=positives, selectionStratum=bucket))
            if len(rows) == sum(QUOTAS.values()) * (len(THEMES) + 1):
                break
    return scanned, rows, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exclude", nargs="+", type=Path, required=True,
                        help="Existing benchmark sample JSON files containing cases")
    parser.add_argument("--scan-limit", type=int, default=1_100_000)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to replace the frozen sample")
    games, boards, exclusions = set(), set(), []
    for path in args.exclude:
        data = path.read_bytes()
        payload = json.loads(data)
        cases = payload if isinstance(payload, list) else payload["cases"]
        exclusions.append(dict(file=path.name, sha256=hashlib.sha256(data).hexdigest()))
        games.update(case["sourceGroup"].removeprefix("game:") for case in cases if case.get("sourceGroup"))
        boards.update(board_identity(chess.Board(case["fen"])) for case in cases)
    request = urllib.request.Request(public.URL, headers={"User-Agent": "EnCroissant-local-research"})
    with urllib.request.urlopen(request, timeout=60) as response:
        headers = {key: response.headers[key] for key in ("Content-Length", "Last-Modified", "ETag")}
        scanned, cases, counts = collect(response, games, boards, args.scan_limit)
    receipt = dict(source=public.URL, sourceHeaders=headers, rowsScanned=scanned, scanLimit=args.scan_limit,
                   themes=THEMES, quotaPerStratum=QUOTAS, exclusionHashes=exclusions,
                   exclusions=dict(games=len(games), boards=len(boards)),
                   strata={split: {theme: counts[split, theme] for theme in (*THEMES, "other")}
                           for split in QUOTAS}, cases=cases)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(receipt, output, separators=(",", ":"))
    print(json.dumps({key: value for key, value in receipt.items() if key != "cases"}, indent=2))


if __name__ == "__main__":
    main()
