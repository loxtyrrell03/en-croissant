"""Measure exact checking replies on two reached classical positions."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "neural-passer-probe"))
from assets import passed, relative_rank
sys.path.insert(0, str(HERE.parent / "reply-search-allocation"))
from search import engines, search


BUCKETS = (
    "reply-coverage-audit/full-pair-input.json",
    "reply-concordance/reserve-scored.json",
    "alternate-capture-payoff/fresh-scored.json",
    "promotion-check-tempo/fresh-scored.json",
    "played-mate-in-three/reserve-scored.json",
)


def exact(row):
    history = row.get("history")
    if not history:
        return chess.Board(row["fen"])
    board = chess.Board(history["fen"])
    for uci in history["moves"]:
        board.push_uci(uci)
    if board.fen() != row["fen"]:
        raise ValueError(f"Wrong history for {row['id']}")
    return board


def choice_pair(row):
    choices = row.get("comparisonCandidates") or row.get("candidates") or []
    if not choices or not row.get("playedMoveUci"):
        return None
    strong = choices[0]
    weak = next((l for l in choices if l["pvUci"][0] == row["playedMoveUci"]), None)
    if not weak or weak is strong:
        return None
    if (not finite(strong) or not finite(weak) or strong["depth"] != weak["depth"]
            or strong["cp"] - weak["cp"] < 120):
        return None
    return strong, weak


def finite(line):
    return bool(line and line["cp"] is not None and line.get("mate") is None and line["depth"] >= 16
                and not line.get("lowerbound") and not line.get("upperbound"))


def chess_move(board, uci):
    try:
        move = chess.Move.from_uci(uci)
    except (TypeError, ValueError):
        return None
    return move if board.is_legal(move) else None


def push(board, move):
    copy = board.copy()
    copy.push(move)
    return copy


def covered_flights(strong, weak, check, defender, moved_to):
    """Return destinations where the relocated piece removes a legal king reply."""
    if check not in weak.legal_moves or not strong.gives_check(check) or not weak.gives_check(check):
        return []
    strong_after, weak_after = push(strong, check), push(weak, check)
    if check.to_square not in strong_after.checkers() or check.to_square not in weak_after.checkers():
        return []
    king = weak_after.king(not defender)
    if king is None or king != strong_after.king(not defender):
        return []
    return [
        move.to_square for move in weak_after.legal_moves
        if move.from_square == king and move not in strong_after.legal_moves
        and moved_to in strong_after.attackers(defender, move.to_square)
    ]


def candidate_checks(after_strong, after_weak, strong_destination):
    defender = after_strong.turn
    checks = {}
    for move in after_weak.legal_moves:
        if not after_weak.gives_check(move):
            continue
        if move.from_square == strong_destination or move not in after_strong.legal_moves:
            continue
        flights = covered_flights(after_strong, after_weak, move, defender, strong_destination)
        if flights:
            checks[move.uci()] = [chess.square_name(square) for square in flights]
    return checks


def nominate(row):
    pair = choice_pair(row)
    if not pair:
        return None
    strong_line, weak_line = pair
    board = exact(row)
    strong_root, weak_root = [chess_move(board, line["pvUci"][0]) for line in pair]
    if not strong_root or not weak_root or strong_root.from_square != weak_root.from_square:
        return None
    if (
        board.piece_type_at(strong_root.from_square) not in (chess.ROOK, chess.BISHOP, chess.QUEEN)
        or any(board.is_capture(move) or board.gives_check(move) for move in (strong_root, weak_root))
        or strong_line["fen"] != board.fen() or weak_line["fen"] != board.fen()
    ):
        return None
    defender = board.turn
    behind = push(board, strong_root)
    alternative = push(board, weak_root)
    analysed = [(weak_line["pvUci"][1], -weak_line["cp"])] if len(weak_line["pvUci"]) >= 2 else []
    for arm in row.get("replyProbes", []):
        if arm["moveUci"] != weak_root.uci():
            continue
        analysed.extend(
            (line["pvUci"][0], line["cp"]) for line in arm["lines"]
            if finite(line) and line["fen"] == alternative.fen()
        )
    seen = set()
    for uci, score in analysed:
        if uci in seen:
            continue
        seen.add(uci)
        if score + strong_line["cp"] < 120:
            continue
        advance = chess_move(behind, uci)
        if (
            not advance or advance not in alternative.legal_moves
            or board.piece_type_at(advance.from_square) != chess.PAWN
            or board.color_at(advance.from_square) == defender
            or relative_rank(advance.from_square, not defender) != 5
            or relative_rank(advance.to_square, not defender) != 6
            or behind.is_capture(advance) or alternative.is_capture(advance)
            or not passed(board, advance.from_square, not defender)
        ):
            continue
        after_strong, after_weak = push(behind, advance), push(alternative, advance)
        checks = candidate_checks(after_strong, after_weak, strong_root.to_square)
        if checks:
            return {
                "id": row["id"], "strong": strong_root.uci(), "weak": weak_root.uci(),
                "push": uci, "betterCp": strong_line["cp"], "playedCp": weak_line["cp"],
                "advanceScoreCp": score, "checks": checks,
            }
    return None


def captured_in_line(board, line, start, horizon, *, king_only=False, pawn_only=False):
    """Track the original pawn or checker. A replacement on its square is distinct."""
    position = board.copy()
    asset = start
    color = position.color_at(asset)
    for i, uci in enumerate(line[:horizon]):
        move = chess_move(position, uci)
        if not move:
            return None
        victim = move.to_square
        if position.is_en_passant(move):
            victim -= 8 if position.turn else -8
        if victim == asset and position.turn != color:
            if king_only and position.piece_type_at(move.from_square) != chess.KING:
                return None
            if pawn_only and position.piece_type_at(asset) != chess.PAWN:
                return None
            return i + 1
        if move.from_square == asset:
            asset = move.to_square
        position.push(move)
    return None


def survives_promotion(board, line, pawn, side):
    """The alternative payoff must belong to this pawn, not another promotion."""
    position = board.copy()
    asset, role, promotion_ply = pawn, chess.PAWN, None
    for ply, uci in enumerate(line[:12], 1):
        move = chess_move(position, uci)
        if not move:
            return False
        if position.turn == side and move.from_square == asset:
            asset = move.to_square
            if move.promotion:
                role, promotion_ply = move.promotion, ply
        position.push(move)
        if position.piece_type_at(asset) != role or position.color_at(asset) != side:
            return False
        if promotion_ply is not None and ply - promotion_ply == 4:
            return True
    return False


def evaluate(row, nomination, executable, nodes):
    start = exact(row)
    strong, weak = start.copy(), start.copy()
    for position, choice in ((strong, nomination["strong"]), (weak, nomination["weak"])):
        position.push_uci(choice)
        position.push_uci(nomination["push"])
    started = {"status": "no-engine-check", "nomination": nomination, "queries": []}
    if strong.is_game_over(claim_draw=True) or weak.is_game_over(claim_draw=True):
        return dict(started, status="draw-or-terminal")
    best = search(strong, executable, nodes, min(2, strong.legal_moves.count()))
    started["queries"].append(best)
    if not best["lines"]:
        return started
    leading = best["lines"][0]
    if not finite(leading):
        return dict(started, status="unscored-defence")
    check = next((
        line for line in best["lines"]
        if finite(line) and line["pvUci"][0] in nomination["checks"]
        and leading["cp"] - line["cp"] <= 50
        and line["cp"] >= nomination["betterCp"] - 90
    ), None)
    if not check:
        return started
    uci = check["pvUci"][0]
    forced = search(weak, executable, nodes, 1, [weak.parse_uci(uci)])
    started["queries"].append(forced)
    weaker = next(iter(forced["lines"]), None)
    if not finite(weaker) or check["cp"] - weaker["cp"] < 120:
        return dict(started, status="score-contrast-missing", chosenCheck=uci)
    if len(weaker["pvUci"]) < 2 or weaker["pvUci"][1][2:4] not in nomination["checks"][uci]:
        return dict(started, status="covered-flight-unused", chosenCheck=uci)
    checking_board = push(weak, weak.parse_uci(uci))
    first_reply = checking_board.parse_uci(weaker["pvUci"][1])
    if checking_board.piece_type_at(first_reply.from_square) != chess.KING:
        return dict(started, status="covered-flight-unused", chosenCheck=uci)
    checker_taken = captured_in_line(checking_board, weaker["pvUci"][1:],
                                     chess.Move.from_uci(uci).to_square, 5, king_only=True)
    pawn_square = chess.Move.from_uci(nomination["push"]).to_square
    promotion = checker_taken is None and survives_promotion(weak, weaker["pvUci"], pawn_square, not weak.turn)
    if checker_taken is None and not promotion:
        return dict(started, status="checker-not-taken", chosenCheck=uci)
    pawn_taken = captured_in_line(strong, check["pvUci"], pawn_square, 12, pawn_only=True)
    if pawn_taken is None:
        return dict(started, status="pawn-payoff-unshown", chosenCheck=uci)
    return dict(started, status="confirmed", chosenCheck=uci, scoreCp=[check["cp"], weaker["cp"]],
                strongLine=check["pvUci"][:pawn_taken],
                weakLine=weaker["pvUci"][:1 + checker_taken] if checker_taken else weaker["pvUci"][:12],
                weakPayoff="same-pawn-promotes" if promotion else "checker-captured")


def screen(lab):
    seen, rows, manifest = set(), [], {}
    for relative in BUCKETS:
        raw = (lab / relative).read_bytes()
        manifest[relative] = sha256(raw).hexdigest()
        for row in json.loads(raw):
            if not row.get("playedMoveUci"):
                continue
            board = chess.Board(row["fen"])
            key = min(board.epd(), board.mirror().epd()), row["playedMoveUci"]
            if key in seen:
                continue
            seen.add(key)
            rows.append(dict(row, cohort=relative))
    return rows, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lab", type=Path)
    parser.add_argument("input", type=Path, help="JSON list of reviewed development controls")
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--explicit-only", action="store_true")
    args = parser.parse_args()
    extra = json.loads(args.input.read_bytes())
    cohort, hashes = ([], {}) if args.explicit_only else screen(args.lab)
    sources = [*(dict(row, cohort=row.get("cohort", "development")) for row in extra), *cohort]
    candidates = [(row, finding) for row in sources if (finding := nominate(row))]
    print(len(sources), "inputs", len(candidates), "geometry nominations", flush=True)
    try:
        with ThreadPoolExecutor(6) as pool:
            def assess(item):
                row, finding = item
                shallow, deep = [evaluate(row, finding, str(args.engine), nodes) for nodes in (500000, 2400000)]
                later = evaluate(row, finding, str(args.engine), 4800000) if deep["status"] == "confirmed" else None
                return dict(row=row, shallow=shallow, reference=deep, repeat=later)
            result = list(pool.map(assess, candidates))
    finally:
        for process in engines:
            process.quit()
    for level in ("shallow", "reference", "repeat"):
        print(level, Counter(item[level]["status"] for item in result if item[level]), flush=True)
    report = {
        "sources": hashes, "blocks": dict(Counter(row["cohort"] for row in sources)),
        "engineSha256": sha256(args.engine.read_bytes()).hexdigest(), "results": result,
    }
    with args.output.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(report, out, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main()
