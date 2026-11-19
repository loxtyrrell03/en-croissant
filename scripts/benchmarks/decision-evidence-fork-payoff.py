"""Build exact-move fork payoff labels from independent Stockfish replies.

A positive is a deliberately narrow engine target. A candidate must make the
same piece threaten two targets and collect one with retained material in up
to two strongest searched replies. Negative labels require an actual refutation
or a non-tactical exchange. Other cases are unknown.
"""

import argparse
from collections import Counter
import concurrent.futures
import hashlib
import importlib
import json
from pathlib import Path
from time import perf_counter

import chess
import chess.engine

corpus = importlib.import_module("decision-evidence-motif-corpus")
engine_tools = importlib.import_module("decision-evidence-engine")
VALUES = (0, 100, 320, 330, 500, 900, 0)
QUICK_NODES = 6000
PROOF_NODES = 120_000
HORIZON = 8
SCHEMA = 1


def read(path):
    return json.loads(path.read_bytes())


def key(text):
    return hashlib.sha256(("exact-fork-v1:" + text).encode()).digest()


def geometry(board, move):
    side = board.turn
    old_targets = board.attacks(move.from_square)
    state = board.copy(stack=False)
    state.push(move)
    targets = state.attacks(move.to_square) & chess.SquareSet(state.occupied_co[not side])
    targets -= state.pieces(chess.PAWN, not side)
    return tuple(targets) if len(targets) >= 2 and targets - old_targets else ()


def nominate_puzzles(payload, per_split):
    groups, boards = {}, {}
    seen_boards = set()
    for row in sorted(payload["cases"], key=lambda row: key(row["game"])):
        split = row["split"]
        quota = per_split if split == "train" else max(1, per_split // 5)
        groups.setdefault(split, [])
        boards.setdefault(split, 0)
        if boards[split] >= quota:
            continue
        board = chess.Board(row["fen"])
        even = []
        for index, uci in enumerate(row["line"][:10]):
            move = board.parse_uci(uci)
            if index % 2 == 0 and geometry(board, move):
                even.append((index, board.copy(stack=False), move))
            board.push(move)
        if not even:
            continue
        ply, board, actual = even[int.from_bytes(key(row["game"])[:4], "big") % len(even)]
        board_key = corpus.board_identity(board)
        if board_key in seen_boards:
            continue
        seen_boards.add(board_key)
        alternatives = [move for move in board.legal_moves if move != actual and geometry(board, move)]
        alternatives.sort(key=lambda move: (
            board.piece_type_at(move.from_square) != board.piece_type_at(actual.from_square),
            board.gives_check(move) != board.gives_check(actual),
            board.is_capture(move) != board.is_capture(actual),
            key(row["game"] + move.uci()),
        ))
        for move in [actual, *alternatives[:1]]:
            groups[split].append(dict(id=f'{row["id"]}-{ply}-{move.uci()}', game=row["game"], split=split,
                                      fen=board.fen(), boardKey=board_key, move=move.uci(),
                                      origin="solution" if move == actual else "alternative"))
        boards[split] += 1
    return [case for group in groups.values() for case in group]


def material(board, side):
    return sum(VALUES[role] * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role in range(chess.PAWN, chess.KING))


def replay_payoff(board, root, targets, line):
    state = board.copy(stack=False)
    side = state.turn
    baseline = material(state, side)
    state.push(root)
    tracker = root.to_square
    victims = {square: square for square in targets}
    collected = None
    changes = [material(state, side) - baseline]
    for index, uci in enumerate(line[:HORIZON], start=2):
        move = state.parse_uci(uci)
        if state.turn != side:
            if move.to_square == tracker:
                tracker = None
            if state.is_castling(move):
                victims = {square: origin for square, origin in victims.items()
                           if state.piece_type_at(square) not in (chess.KING, chess.ROOK)}
            if move.from_square in victims:
                victims[move.to_square] = victims.pop(move.from_square)
        elif state.is_capture(move) and move.to_square in victims:
            if move.from_square == tracker and victims[move.to_square] == move.to_square and collected is None:
                collected = (index, victims[move.to_square], uci)
            del victims[move.to_square]
        if state.turn == side and move.from_square == tracker:
            tracker = move.to_square
        state.push(move)
        changes.append(material(state, side) - baseline)
    settled = min(changes[-2:]) if len(changes) >= 3 else None
    return dict(collected=list(collected) if collected else None, settled=settled,
                movement=changes, forkerSurvives=tracker is not None)


def label_payoff(board, move, targets, frames):
    post = board.copy(stack=False)
    post.push(move)
    if post.is_game_over():
        return False, "game-ends-at-root", []
    if not frames:
        return None, "no-complete-replies", []
    proof = [replay_payoff(board, move, targets, frame["pv"]) for frame in frames]
    top = proof[0]
    if all(branch["collected"] and branch["collected"][0] <= 5 and branch["settled"] is not None
           and branch["settled"] >= 100 for branch in proof):
        # Clear material collection in the best defences cannot rescue an
        # unsound fork if the opponent has the better overall position.
        if all(frame["mate"] is None and frame["cp"] <= -65 for frame in frames):
            return True, "fork-target-retained", proof
    if frames[0]["mate"] is not None and frames[0]["mate"] > 0:
        return False, "opponent-forces-mate", proof
    if (not top["forkerSurvives"] or top["collected"]) and top["settled"] is not None and top["settled"] <= 0:
        if frames[0]["mate"] is None and frames[0]["cp"] >= -25:
            return False, "best-defence-neutralizes-material", proof
    return None, "unresolved-payoff", proof


def search(engine, board, nodes):
    if board.is_game_over():
        return []
    count = min(2, board.legal_moves.count())
    reducer = engine_tools.CompleteVariations(board, count)
    engine.configure({"Clear Hash": None})
    with engine.analysis(board, chess.engine.Limit(nodes=nodes), multipv=count) as analysis:
        for info in analysis:
            reducer.add(info)
    return [dict(depth=info["depth"], nodes=info["nodes"], cp=info["score"].relative.score(),
                 mate=info["score"].relative.mate(), pv=[move.uci() for move in info["pv"]])
            for info in reducer.best or []]


def examine(batch):
    cases, executable, folder, fingerprint = batch
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Threads": 1, "Hash": 32})
        for row in cases:
            path = folder / (row["id"] + ".json")
            identity = dict(row, search=fingerprint)
            if path.exists():
                if read(path)["identity"] != identity:
                    raise ValueError(f"Cached position mismatch for {row['id']}")
                continue
            board = chess.Board(row["fen"])
            root = board.parse_uci(row["move"])
            targets = geometry(board, root)
            if not targets:
                raise ValueError(f"Candidate lacks fork geometry: {row['id']}")
            post = board.copy(stack=False)
            post.push(root)
            cheap = search(engine, post, QUICK_NODES)
            deep = search(engine, post, PROOF_NODES)
            label, reason, proof = label_payoff(board, root, targets, deep)
            engine_tools.atomic_json(path, dict(identity=identity, fen=board.fen(), move=root.uci(), quick=cheap,
                                                deep=deep, label=label, reason=reason, witness=proof))
    return len(cases)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("engine", type=Path)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--nominate", action="store_true")
    parser.add_argument("--train-games", type=int, default=1200)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6)
    args = parser.parse_args()
    inputs = read(args.sample)
    candidates = nominate_puzzles(inputs, args.train_games) if args.nominate else inputs["cases"]
    if not candidates or len({case["id"] for case in candidates}) != len(candidates):
        raise ValueError("Expected distinct legal candidate identities")
    args.cache.mkdir(parents=True, exist_ok=True)
    fingerprint = dict(schema=SCHEMA, engine=hashlib.sha256(args.engine.read_bytes()).hexdigest(),
                       quickNodes=QUICK_NODES, proofNodes=PROOF_NODES, maxReplies=2, horizon=HORIZON,
                       protocolFile=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    for row in candidates:
        if not row["id"].replace("-", "").replace("_", "").isalnum():
            raise ValueError("Candidate ID is not a safe filename")
    groups = [candidates[offset:offset + 30] for offset in range(0, len(candidates), 30)]
    tasks = [(group, str(args.engine.resolve()), args.cache, fingerprint) for group in groups]
    start = perf_counter()
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        pending = [pool.submit(examine, task) for task in tasks]
        completed = 0
        for done in concurrent.futures.as_completed(pending):
            completed += done.result()
            print(f"{completed}/{len(candidates)} candidate moves", flush=True)
    rows = [read(args.cache / (row["id"] + ".json")) for row in candidates]
    manifest = dict(fingerprint=fingerprint, sampleSha256=hashlib.sha256(args.sample.read_bytes()).hexdigest(),
                    durationSeconds=perf_counter() - start, perSplit={
                        split: dict(Counter(row["reason"] for row in rows if row["identity"]["split"] == split))
                        for split in sorted({row["split"] for row in candidates})
                    }, ids=[row["id"] for row in candidates])
    engine_tools.atomic_json(args.cache / "receipt.json", manifest)


if __name__ == "__main__":
    main()
