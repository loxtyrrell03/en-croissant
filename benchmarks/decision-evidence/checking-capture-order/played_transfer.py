"""Freeze public game decisions whose recorded continuation checks before capturing."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "paired-choice-training"))
from freeze import board_key, game_key, normalized_family, records
from search_pairs import cp, engines, initial, select_lines

LIMIT = 80


def takes_original_piece(board, line):
    played, checking, defence, capture = line
    after = board.copy(stack=False)
    after.push(played)
    victim = after.piece_at(capture.to_square)
    if (
        not after.gives_check(checking) or not victim or victim.color != board.turn
        or victim.piece_type in (chess.PAWN, chess.KING)
        or capture not in after.legal_moves or not after.is_capture(capture)
        or defence.from_square == capture.to_square or defence.to_square == capture.to_square
        or checking.from_square == capture.from_square or checking.to_square == capture.from_square
    ):
        return False
    after.push(checking)
    after.push(defence)
    return after.is_capture(capture)


def freeze(source, prior):
    exclude = [row for path in prior for row in records(path) if row.get("fen")]
    boards = {board_key(chess.Board(row["fen"])) for row in exclude}
    games = {game_key(row) for row in exclude if len((row.get("history") or {}).get("moves", [])) >= 24}
    omit = {"finnish-championship-2025", "asian-zone-33-chess-championship-2025"}
    sources = json.loads(source.read_bytes())
    pools = defaultdict(list)

    for name, metadata in sorted(sources.items()):
        event = normalized_family(metadata["event"])
        if event in omit:
            continue
        path = source.parent / name
        if sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError(f"Source changed: {name}")
        with path.open(encoding="utf-8-sig", errors="replace") as stream:
            while (game := chess.pgn.read_game(stream)) is not None:
                board = game.board()
                start = board.fen()
                if board.chess960 or game.errors or game.headers.get("Result", "*") == "*":
                    continue
                moves = list(game.mainline_moves())
                ucis = [move.uci() for move in moves]
                signature = game_key({"history": {"fen": start, "moves": ucis}})
                if signature in games:
                    continue
                selected = []
                for ply, move in enumerate(moves):
                    if 24 <= ply < min(104, len(moves) - 5) and not board.is_check():
                        key = board_key(board)
                        line = moves[ply:ply + 4]
                        if key not in boards and takes_original_piece(board, line):
                            token = sha256(f"played-checking-order-v1|{signature}|{ply}".encode()).hexdigest()
                            selected.append((token, key, ply, board.fen()))
                    board.push(move)
                if not selected:
                    continue
                token, key, ply, fen = min(selected)
                games.add(signature)
                boards.add(key)
                site = game.headers.get("Site", "")
                pools[event].append({
                    "id": token[:20], "event": event, "game": signature, "fen": fen,
                    "history": {"fen": start, "moves": ucis[:ply]},
                    "playedMoveUci": ucis[ply], "checkingMove": ucis[ply + 1],
                    "directCapture": ucis[ply + 3],
                    "site": site if site.startswith("https://lichess.org/broadcast/") else metadata["round"],
                })
    groups = [sorted(rows, key=lambda row: row["id"]) for _, rows in sorted(pools.items())]
    return [rows[i] for i in range(max(map(len, groups), default=0)) for rows in groups if i < len(rows)][:LIMIT]

def capture_frames(row, exe):
    board = initial(row)
    roots = select_lines(board, exe, 2_400_000, min(3, board.legal_moves.count()))
    best = roots[0]["pvUci"][0] if roots else None
    played = row["playedMoveUci"]
    if not best or best == played:
        return dict(row, candidates=roots, label="not-a-tested-mistake")
    pair = select_lines(board, exe, 2_400_000, 2, [board.parse_uci(best), board.parse_uci(played)])
    if len(pair) != 2 or pair[0]["pvUci"][0] != best:
        return dict(row, candidates=roots, comparisonCandidates=pair, label="unresolved")
    replies = []
    for move in (best, played):
        child = board.copy()
        child.push_uci(move)
        line = select_lines(child, exe, 1_400_000, min(2, child.legal_moves.count()))
        if line:
            replies.append({"moveUci": move, "lines": line})

    at = board.copy()
    at.push_uci(played)
    compared = select_lines(at, exe, 3_600_000, 2, [at.parse_uci(row["checkingMove"]),
                                                  at.parse_uci(row["directCapture"])])
    scores = {line["pvUci"][0]: line for line in compared}
    label = "unresolved"
    difference = None
    if len(scores) == 2 and all(line["cp"] is not None for line in compared):
        difference = cp(scores[row["checkingMove"]]) - cp(scores[row["directCapture"]])
        if abs(difference) <= 35 or difference < -100:
            label = "check-order-unnecessary"
        elif (difference >= 100 and cp(pair[0]) - cp(pair[1]) >= 100 and
              scores[row["checkingMove"]]["pvUci"][2:3] == [row["directCapture"]]):
            label = "different-order-outcome"
    return dict(row, candidates=roots, comparisonCandidates=pair, replyProbes=replies,
                label=label, referenceOrderCp=difference, orderReference=compared)


def write(path, value):
    with path.open("x", encoding="utf-8") as out:
        json.dump(value, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("freeze", "score"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--prior", nargs="+", default=[], type=Path)
    args = parser.parse_args()
    if args.mode == "freeze":
        value = freeze(args.input, args.prior)
        print(f"Frozen {len(value)} independent classical games")
    else:
        if not args.engine:
            parser.error("--engine is required when scoring")
        try:
            with ThreadPoolExecutor(7) as pool:
                value = list(pool.map(lambda row: capture_frames(row, str(args.engine)), records(args.input)))
        finally:
            for worker in engines:
                worker.quit()
        print(Counter(row["label"] for row in value))
    write(args.output, value)
