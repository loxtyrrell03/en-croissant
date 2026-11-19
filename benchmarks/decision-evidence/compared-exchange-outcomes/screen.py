"""Screen alternate exchange explanations on the archived development replay."""
from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import sys

import chess


VALUES = dict(zip(chess.PIECE_TYPES, (100, 320, 330, 500, 900, 0)))
HORIZON = 13


@dataclass
class Step:
    move: chess.Move
    san: str
    capture: int | None
    material: int
    check: bool
    quiet: bool
    present: set[int]


def sequence(root, pv, limit=HORIZON):
    board = root.copy(stack=False)
    original = {square: square for square in root.piece_map()}
    side = root.turn
    value = lambda: sum(VALUES[piece.piece_type] * (1 if piece.color == side else -1)
                        for piece in board.piece_map().values())
    total = value()
    steps = []
    for uci in pv[:limit]:
        move = board.parse_uci(uci)
        promotion = move.promotion is not None
        if board.is_game_over():
            break
        san = board.san(move)
        taken = None
        if board.is_capture(move):
            square = move.to_square
            if board.is_en_passant(move):
                square += -8 if board.turn else 8
            taken = original.pop(square, None)
        if board.is_castling(move):
            rank = chess.square_rank(move.from_square) * 8
            kingside = board.is_kingside_castling(move)
            rook_from = rank + (7 if kingside else 0)
            rook_to = rank + (5 if kingside else 3)
            original[rook_to] = original.pop(rook_from)
        original[move.to_square] = original.pop(move.from_square)
        board.push(move)
        check = board.is_check()
        steps.append(Step(move, san, taken, value() - total, check,
                          not (check or taken is not None or promotion), set(original.values())))
        if board.is_game_over():
            break
    return steps


def settles(steps, horizon):
    return horizon >= 5 and (
        len({step.material for step in steps[horizon - 4:horizon]}) == 1
        and all(step.quiet for step in steps[horizon - 2:horizon])
    )


def route_changes(root, good, bad, payoff):
    alternative = root.copy(stack=False)
    alternative.push(good[0].move)
    for index in range(1, payoff + 1):
        step = bad[index]
        if step.move not in alternative.legal_moves:
            return index % 2 == 1
        capture = alternative.is_capture(step.move)
        alternative.push(step.move)
        if index % 2 == 1 and (step.check and not alternative.is_check() or
                              step.capture is not None and not capture):
            return True
    return False


def propose(root, good, bad):
    seen = {}
    for horizon in range(5, min(len(good), len(bad)) + 1):
        retained, lost = good[horizon - 1], bad[horizon - 1]
        if lost.material > -100 or retained.material - lost.material < 100:
            continue
        if not settles(good, horizon) or not settles(bad, horizon):
            continue
        if any(later.material > lost.material + 99 for later in bad[horizon:]):
            continue
        seen.setdefault("material", (None, horizon, None))
        for index in range(3, min(8, horizon - 3), 2):
            victim = bad[index].capture
            if victim is None or victim not in retained.present:
                continue
            if any(victim not in later.present for later in good[horizon:]):
                continue
            if not all(step.check or step.capture is not None for step in bad[1:index:2]):
                continue
            seen.setdefault("delayed", (victim, horizon, index))
            if route_changes(root, good, bad, index):
                seen.setdefault("contrast", (victim, horizon, index))
    return seen


def stable_loss(good, bad, horizon):
    if not settles(good, horizon) or not settles(bad, horizon):
        return False
    retained, lost = good[horizon - 1], bad[horizon - 1]
    return (lost.material <= -100 and retained.material - lost.material >= 100 and
            all(step.material <= lost.material + 99 for step in bad[horizon:]))


def confirm(root, good, bad, second):
    arms = {}
    for horizon in range(5, min(len(good), len(bad), len(second)) + 1):
        if not all(stable_loss(good, branch, horizon) for branch in (bad, second)):
            continue
        arms.setdefault("material", [None, horizon, None, None])
        candidates = []
        for branch in (bad, second):
            payoff = {}
            for index in range(1, min(8, horizon - 3), 2):
                victim = branch[index].capture
                if victim is None or victim not in good[horizon - 1].present:
                    continue
                if any(victim not in later.present for later in good[horizon:]):
                    continue
                payoff.setdefault(victim, index)
            candidates.append(payoff)
        matching = set(candidates[0]).intersection(candidates[1])
        for victim in sorted(matching):
            first, other = (entry[victim] for entry in candidates)
            if min(first, other) <= 1:
                continue
            forcing = all(
                all(step.check or step.capture is not None for step in branch[1:payoff:2])
                for branch, payoff in ((bad, first), (second, other))
            )
            disrupted = route_changes(root, good, bad, first) and route_changes(root, good, second, other)
            if forcing:
                arms.setdefault("delayed", [victim, horizon, first, other])
            if forcing and disrupted:
                arms.setdefault("contrast", [victim, horizon, first, other])
            if root.piece_type_at(victim) != chess.PAWN:
                arms.setdefault("piece", [victim, horizon, first, other])
                if disrupted:
                    arms.setdefault("piece-route", [victim, horizon, first, other])
    return arms


def fit(item, incumbent):
    label = incumbent.get("label") or {}
    report = incumbent["result"]
    if not report or label.get("tactical") is None:
        return []
    is_mistake = report["mistakeStatus"] != "not-requested"
    axis = (report["mistake"] or {}) if is_mistake else report["position"]
    if axis.get("tactical", {}).get("support") == "supported":
        return []
    lines = (item.get("comparisonCandidates") if is_mistake else None) or item["candidates"]
    if not lines or lines[0]["cp"] is None or lines[0]["depth"] < 16:
        return []
    if is_mistake and lines[0]["pvUci"][0] != item["candidates"][0]["pvUci"][0]:
        return []
    board = chess.Board(item["fen"])
    try:
        good = sequence(board, lines[0]["pvUci"])
    except ValueError:
        return []
    probes = {
        probe["moveUci"]: probe["lines"][0]
        for probe in item.get("replyProbes", []) + item.get("referenceReplies", [])
        if probe["lines"]
    }
    records = []
    for bad in lines[1:]:
        if is_mistake and bad["pvUci"][0] != item["playedMoveUci"]:
            continue
        if bad["cp"] is None or lines[0]["depth"] != bad["depth"] or lines[0]["cp"] - bad["cp"] < 100:
            continue
        try:
            loss = sequence(board, bad["pvUci"])
            result = propose(board, good, loss)
        except (ValueError, KeyError):
            continue
        if not result:
            continue
        alt = bad["pvUci"][0]
        corroboration = False
        if alt in probes and probes[alt]["cp"] is not None:
            reply = probes[alt]
            if reply["depth"] >= 16 and abs(bad["cp"] + reply["cp"]) <= 90:
                second = propose(board, good, sequence(board, [alt, *reply["pvUci"]]))
                corroboration = (result.get("contrast") is not None and second.get("contrast") is not None
                                 and result["contrast"][0] == second["contrast"][0])
        records.append({
            "id": item["id"], "scope": "mistake" if is_mistake else "position",
            "label": label, "fen": item["fen"], "candidate": alt, "results": result,
            "corroborated": corroboration,
            "better": [step.san for step in good], "worse": [step.san for step in loss],
            "gap": lines[0]["cp"] - bad["cp"],
        })
    return records


if __name__ == "__main__":
    inputs, reports, output = map(Path, sys.argv[1:])
    observed = [
        hit for item, incumbent in zip(json.loads(inputs.read_bytes()),
                                        json.loads(reports.read_bytes()), strict=True)
        for hit in fit(item, incumbent)
    ]
    print(Counter((h["scope"], arm, h["label"]["tactical"]) for h in observed for arm in h["results"]))
    print(Counter((h["scope"], h["label"]["tactical"]) for h in observed if h["corroborated"]))
    output.write_text(json.dumps(observed, ensure_ascii=False, indent=2), encoding="utf-8")
