"""Verify a tactical interruption of a previously available castle."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

import chess

from freeze import digest, write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import finite, initial, track_move


MIN_EDGE = 70
EQUAL_EDGE = 30
MATERIAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def san(board, moves, plies=8):
    return board.variation_san([chess.Move.from_uci(uci) for uci in moves[:plies]])


def king_steps(board, uci):
    move = chess.Move.from_uci(uci)
    return board.is_legal(move) and board.piece_type_at(move.from_square) == chess.KING and not board.is_castling(move)


def balance(board, side):
    return sum(value * (len(board.pieces(role, side)) - len(board.pieces(role, not side)))
               for role, value in MATERIAL.items())


def forcing_loss(board, pv):
    """Attribute the gain to an original target caught with a checking tempo."""
    side = board.turn
    start = balance(board, side)
    positions = {square: square for square in board.piece_map()}
    work = board.copy()
    took, trail = set(), []
    checked_before = False
    for uci in pv[:8]:
        move = work.parse_uci(uci)
        attacker = work.turn == side
        captured = track_move(work, move, positions)
        work.push(move)
        gives_check = work.is_check()
        if attacker and captured is not None and (gives_check or checked_before):
            took.add(captured)
        if attacker:
            checked_before = gives_check
        trail.append(balance(work, side) - start)
    if len(trail) >= 6 and min(trail[-2:]) >= 1:
        return took, min(trail[-2:])
    return set(), 0


def repeat_late_loss(board, choice, probe):
    if not probe or not finite(probe) or not finite(choice):
        return None
    move = choice["pvUci"][0]
    uci = choice["pvUci"][1:]
    if not uci or uci[0] != probe["pvUci"][0] or abs(choice["cp"] + probe["cp"]) > 90:
        return None
    child = board.copy()
    child.push_uci(move)
    root, root_gain = forcing_loss(child, uci)
    separate, separate_gain = forcing_loss(child, probe["pvUci"])
    shared = root & separate
    if shared:
        return dict(castle=move, threats=[chess.square_name(square) for square in sorted(shared)],
                    minimumMaterialGain=min(root_gain, separate_gain),
                    exactUci=[move, *probe["pvUci"][:8]], line=san(child, probe["pvUci"]))
    return None


def examine(case):
    board = initial(case)
    played = case["playedMoveUci"]
    castles = case["castles"]
    roots = {line["pvUci"][0]: line for line in case["candidates"]}
    pairs = {line["pvUci"][0]: line for line in case["allExactChoices"]}
    early = next((uci for uci in pairs if uci in castles), None)
    weak = pairs.get(played)
    if not early or not weak or not finite(weak) or not finite(pairs[early]):
        return dict(status="unresolved", why="incomplete exact root scores")
    castle = pairs[early]
    gap = castle["cp"] - weak["cp"]
    result = dict(early=early, played=played, rootGap=gap,
                  earlySan=san(board, castle["pvUci"]), playedSan=san(board, weak["pvUci"]))

    def verdict(status, why, **extra):
        return dict(result, status=status, why=why, **extra)

    if gap <= EQUAL_EDGE:
        return verdict("negative", "immediate castling does not materially improve on the delay")
    if gap < MIN_EDGE or early not in roots:
        return verdict("unresolved", "root choice is not close enough to a stable leading castle")
    leader = case["candidates"][0]
    if not finite(leader) or not finite(roots[early]) or leader["cp"] - roots[early]["cp"] > 35:
        return verdict("unresolved", "other root choices may address the position better")
    probes = {probe["moveUci"]: probe["lines"][0] for probe in case.get("replyProbes", []) if probe["lines"]}
    attack, defence = probes.get(played), probes.get(early)
    if (not attack or not defence or not finite(attack) or not finite(defence) or
            abs(weak["cp"] + attack["cp"]) > 90 or abs(castle["cp"] + defence["cp"]) > 90):
        return verdict("unresolved", "independent root replies are missing or unstable")
    hit = attack["pvUci"][0]
    result.update(attack=hit, replyLine=san(board, [played, *attack["pvUci"]]))
    if weak["pvUci"][1:2] != [hit] or len(weak["pvUci"]) < 3 or len(attack["pvUci"]) < 2:
        return verdict("unresolved", "searches give a different reply after the delay")
    result["naive"] = case["shape"] in {"checked-king-move", "quiet-king-move"}
    early_match = case.get("sameAfterCastle", [])
    if case.get("sameReplyIllegal"):
        result["sameReplyIllegal"] = True
    elif early_match and finite(early_match[0]):
        effect = attack["cp"] - early_match[0]["cp"]
        result.update(sameAttackGap=effect, earlyControl=san(board, [early, *early_match[0]["pvUci"]]))
        if effect <= EQUAL_EDGE:
            return verdict("negative", "the same attack retains its strength after castling first")
        if effect < MIN_EDGE:
            return verdict("unresolved", "unclear effect of castling first on the same attack")
    else:
        return verdict("unresolved", "the same attack has no independent comparison")

    exposed = board.copy()
    exposed.push_uci(played)
    exposed.push_uci(hit)
    late = case.get("late")
    legal_late = [move.uci() for move in exposed.generate_castling_moves()]
    if not legal_late:
        if exposed.is_check() and all(king_steps(exposed, uci) for uci in (weak["pvUci"][2], attack["pvUci"][1])):
            king_only = all(king_steps(exposed, move.uci()) for move in exposed.legal_moves)
            return verdict("positive", "both lines move the checked king and lose its castling rights",
                           mechanism="checked-king", checkedKingForced=king_only)
        return verdict("unresolved", "the king does not move in both replies to a check")
    if not late or legal_late != late["castles"]:
        return verdict("unresolved", "missing exact late castle comparison")
    variants = {line["pvUci"][0]: line for line in late["choices"]}
    if not set(legal_late).issubset(variants) or len(variants) < len(legal_late) + 1 or any(
        not finite(line) for line in variants.values()
    ):
        return verdict("unresolved", "unfinished late castling score")
    best = max((line for uci, line in variants.items() if uci not in legal_late), key=lambda line: line["cp"])
    late_edge = min(best["cp"] - variants[uci]["cp"] for uci in legal_late)
    result["lateCastleGap"] = late_edge
    if late_edge <= EQUAL_EDGE:
        return verdict("negative", "castling after the attack is still competitive")
    if late_edge < MIN_EDGE:
        return verdict("unresolved", "castling later is somewhat worse without a decisive comparison")
    replies = {probe["moveUci"]: probe["lines"][0] for probe in late["replyProbes"] if probe["lines"]}
    losses = [repeat_late_loss(exposed, variants[uci], replies.get(uci)) for uci in legal_late]
    if any(loss is None for loss in losses):
        return verdict("unresolved", "the late castle has no repeated forcing loss on an original target")
    return verdict("positive", "both late-castle searches repeat a forcing material loss",
                   mechanism="punished-castle", losingCastles=losses)


def totals(rows):
    counts = Counter()
    for item in rows:
        app, reference = item["app"], item["reference"]
        status = reference["status"]
        counts[f"reference {status}"] += 1
        arms = []
        if app.get("naive"):
            arms.append("played outcome")
        if app["status"] == "positive":
            arms.append("checked and legal late castle")
            if app["mechanism"] == "checked-king":
                arms.append("checked king only")
        for arm in arms:
            outcome = status
            if status == "positive" and arm != "played outcome" and any(
                app.get(key) != reference.get(key) for key in ("early", "attack", "mechanism")
            ):
                outcome = "unmatched"
            counts[f"{arm} {outcome}"] += 1
    return dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "reference", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    stage = [json.loads(path.read_bytes()) for path in (args.app, args.reference)]
    if [r["id"] for r in stage[0]] != [r["id"] for r in stage[1]]:
        raise ValueError("Different app and reference decision sets")
    rows = [dict(id=x["id"], site=x["site"], fen=x["fen"], shape=x["shape"],
                 app=examine(x), reference=examine(y)) for x, y in zip(*stage)]
    counts = totals(rows)
    write(args.output, dict(counts=counts, cases=rows, hashes=[digest(path.read_bytes()) for path in (args.app, args.reference)]))
    print(counts, flush=True)


if __name__ == "__main__":
    main()
