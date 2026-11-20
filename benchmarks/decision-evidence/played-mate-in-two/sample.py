"""Freeze exact short-mate mistakes and counterexamples from broadcast game scores."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path

import chess
import chess.pgn

base_path = Path("benchmarks/decision-evidence/quiet-mate-in-two/sample.py")
spec = importlib.util.spec_from_file_location("quiet_reference", base_path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def verify_start(board, move):
    if not board.is_legal(move):
        return None
    board.push(move)
    try:
        if board.is_game_over(claim_draw=True):
            return None
        answers = {}
        for reply in list(board.legal_moves):
            board.push(reply)
            mate = next(shared.mates_one(board), None)
            board.pop()
            if mate is None:
                return None
            answers[reply.uci()] = mate.uci()
        return answers or None
    finally:
        board.pop()


def forced_two(board, include_quiet=True):
    for move in list(board.legal_moves):
        if include_quiet or board.gives_check(move):
            if witness := verify_start(board, move):
                return move, witness
    return None


def wins_next(board):
    return next(shared.mates_one(board), None) is not None


def root_offer(board, move, use_quiet):
    reached = board.copy()
    reached.push(move)
    if reached.is_game_over(claim_draw=True) or reached.halfmove_clock >= 96:
        return None
    if wins_next(reached):
        return dict(kind="mate-one")
    witness = forced_two(reached, use_quiet)
    if witness:
        start, defence = witness
        good = []
        for option in list(board.legal_moves):
            if option == move:
                continue
            other = board.copy()
            other.push(option)
            if not wins_next(other) and not forced_two(other):
                good.append(option.uci())
                if len(good) >= 2:
                    break
        if good:
            return dict(kind="allowed-two",
                        checking=reached.gives_check(start),
                        forcedStart=start.uci(), answers=defence, avoiding=good)
        return dict(kind="unavoidable-two", checking=reached.gives_check(start),
                    forcedStart=start.uci(), answers=defence)
    example = shared.cooperative(reached)
    if example and not forced_two(reached):
        return dict(kind="cooperative", hint=example)
    return None


def sample_event(job):
    path, excluded_games, excluded_boards = job
    picks, population = [], Counter()
    with path.open(encoding="utf-8-sig", errors="replace") as stream:
        while (game := chess.pgn.read_game(stream, Visitor=shared.Broadcast)) is not None:
            site = game.headers.get("Site", "")
            clock = game.headers.get("TimeControl", "").split("+")[0].split("/")[-1]
            if (game.errors or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2") or
                any(f"-{label}-" in site.lower() for label in ("rapid", "blitz", "bullet", "armageddon")) or
                clock.isdecimal() and int(clock) < 3600):
                continue
            board = game.board()
            start = board.fen()
            nodes = list(game.mainline())
            moves = [node.move for node in nodes]
            if board.chess960 or not board.is_valid() or len(moves) < 30:
                continue
            signature = shared.identity(start, moves)
            if signature in excluded_games:
                continue
            possible = []
            for ply, node in enumerate(nodes):
                move = node.move
                if 38 <= ply < min(175, len(moves)):
                    before, after = node.parent.eval(), node.eval()
                    suffered = after.pov(board.turn) if after else None
                    initial = before.pov(board.turn) if before else None
                    # Annotated possible mates and converted swings have priority.
                    # Untagged game endings remain eligible for geometric discovery.
                    before_cp = initial.score() if initial else 0
                    after_cp = suffered.score() if suffered else -400
                    if ((after_cp is None or after_cp <= -250 or (initial and before_cp is not None and before_cp-after_cp>=100))
                        and shared.board_key(board) not in excluded_boards):
                        kind = root_offer(board, move, suffered is not None and suffered.mate() == -2)
                        if kind:
                            token=hashlib.sha256(f"played-mate-proof-v1:{signature}:{ply}".encode()).hexdigest()[:16]
                            row=dict(id=f"played-two-{token}", fen=board.fen(), game=signature,
                                     playedMoveUci=move.uci(), gameMoveUci=move.uci(), reference=kind,
                                     site=site, event=path.stem,
                                     history=dict(fen=start, moves=[m.uci() for m in moves[:ply]]))
                            possible.append(row)
                            population[kind["kind"]]+=1
                board.push(move)
            rank=lambda row: (row["reference"]["kind"] != "allowed-two", row["id"])
            if possible:
                picks.append(min(possible, key=rank))
    print(path.name, len(picks), dict(population), flush=True)
    return picks, dict(population)


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, separators=(",", ":"))


def freeze(args):
    boards, games = set(), set()
    for path in args.exclude:
        for item in read(path):
            boards.add(shared.board_key(chess.Board(item["fen"])))
            history = item.get("history")
            if history and len(history["moves"]) >= 24:
                moves = [chess.Move.from_uci(move) for move in history["moves"][:24]]
                games.add(shared.identity(history["fen"], moves))
    rows, sources = [], {}
    tasks = [(path, games, boards) for path in args.sources]
    with ProcessPoolExecutor(max_workers=6) as pool:
        for path, (picks, population) in zip(args.sources, pool.map(sample_event, tasks), strict=True):
            rows.extend(picks)
            sources[str(path)] = dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                      population=population)
    frozen, counts, by_event = [], Counter(), Counter()
    for row in sorted(rows, key=lambda item: item["id"]):
        key = shared.board_key(chess.Board(row["fen"]))
        kind, event = row["reference"]["kind"], row["event"]
        if (row["game"] in games or key in boards or counts[kind] >= args.quota
            or by_event[kind, event] >= args.per_event):
            continue
        games.add(row["game"])
        boards.add(key)
        counts[kind] += 1
        by_event[kind, event] += 1
        frozen.append(row)
    write(args.output, frozen)
    write(args.manifest, dict(sources=sources, cases=counts))
    print("Frozen", dict(counts))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("sources", type=Path, nargs="+")
    parser.add_argument("--exclude", type=Path, nargs="+", default=[])
    parser.add_argument("--quota", type=int, default=14)
    parser.add_argument("--per-event", type=int, default=5)
    freeze(parser.parse_args())
