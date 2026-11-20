"""Find and review quiet attacks against two pieces aligned by the played move."""

import argparse
from hashlib import sha256
import json
from pathlib import Path

import chess

SLIDERS = {
    chess.BISHOP: ((1, 1), (1, -1), (-1, 1), (-1, -1)),
    chess.ROOK: ((1, 0), (-1, 0), (0, 1), (0, -1)),
}
SLIDERS[chess.QUEEN] = SLIDERS[chess.BISHOP] + SLIDERS[chess.ROOK]
TARGETS = (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330, chess.ROOK: 500, chess.QUEEN: 900}


def ray_targets(board, square, directions):
    for dx, dy in directions:
        x, y = chess.square_file(square), chess.square_rank(square)
        pieces = []
        while 0 <= (x := x + dx) < 8 and 0 <= (y := y + dy) < 8:
            candidate = chess.square(x, y)
            piece = board.piece_at(candidate)
            if not piece:
                continue
            if piece.color != board.turn or piece.piece_type not in TARGETS:
                break
            pieces.append(candidate)
            if len(pieces) == 2:
                yield tuple(pieces)
                break


def aligned_after_reply(after_played, moved_square, reply):
    directions = SLIDERS.get(after_played.piece_type_at(reply.from_square))
    if not directions or after_played.is_capture(reply) or after_played.gives_check(reply):
        return []
    reached = after_played.copy(stack=False)
    reached.push(reply)
    threats = reached.copy(stack=False)
    threats.push(chess.Move.null())
    return [pair for pair in ray_targets(reached, reply.to_square, directions)
            if moved_square in pair and chess.Move(reply.to_square, pair[0]) in threats.legal_moves]


def prefix(board, pv):
    copy = board.copy(stack=True)
    for uci in pv:
        copy.push_uci(uci)
    return copy


def view(found, move):
    return next((probe["lines"] for probe in found.get("replyProbes", [])
                 if probe["moveUci"] == move), [])


def evaluated(row):
    """Select only comparable paired choices and a corroborated initial reply."""
    comparison = row.get("comparisonCandidates") or []
    if len(comparison) < 2:
        return None
    better, played = comparison[:2]
    best_uci, actual_uci = better["pvUci"][0], played["pvUci"][0]
    if actual_uci != row.get("playedMoveUci") or best_uci != row["candidates"][0]["pvUci"][0]:
        return None
    known = view(row, actual_uci)
    if not known or any(line["cp"] is None or line.get("mate") is not None
                        for line in (better, played, known[0])):
        return None
    if (better["cp"] - played["cp"] < 100 or abs(played["cp"] + known[0]["cp"]) > 90
        or any(line["depth"] < 16 or len(line["pvUci"]) < 3 for line in (better, played, known[0]))):
        return None
    reply_uci = known[0]["pvUci"][0]
    if reply_uci != played["pvUci"][1]:
        return None
    root = chess.Board(row["fen"])
    actual = chess.Move.from_uci(actual_uci)
    if actual.promotion or root.is_capture(actual) or root.is_check():
        return None
    bad = prefix(root, (actual_uci,))
    reply = chess.Move.from_uci(reply_uci)
    good = prefix(root, (best_uci,))
    if reply not in good.legal_moves:
        return None
    pairs = aligned_after_reply(bad, actual.to_square, reply)
    if not pairs:
        return None
    return root, better, played, known[0], view(row, best_uci), pairs


def material(board, color):
    return sum(weight * (len(board.pieces(role, color)) - len(board.pieces(role, not color)))
               for role, weight in VALUE.items())


def payments(root, branch, ray, targets):
    """Credit only the original slider and its actual victim in this line."""
    board = root.copy(stack=True)
    side = root.turn
    initial = material(root, side)
    live = set(targets)
    captured = []
    for ply, uci in enumerate(branch[:9], 1):
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return
        if ply > 2:
            if ray is not None and board.turn != side and move.from_square == ray:
                if move.to_square in live and board.is_capture(move):
                    captured.append((move.to_square, ply, uci, material(board, side)))
                ray = move.to_square
            elif board.turn == side and move.to_square == ray and board.is_capture(move):
                ray = None
            live.discard(move.from_square)
            live.discard(move.to_square)
        board.push(move)
        # Allow the player to recapture on the very next turn before scoring.
        checkpoint = material(board, side) if captured and ply % 2 else None
        if checkpoint is not None and not board.is_check() and initial - checkpoint >= 100:
            for square, at, take, before_capture in captured:
                if at + 1 <= ply <= at + 3 and before_capture - checkpoint >= 100:
                    yield (square, ply, take)


def preview(row):
    context = evaluated(row)
    if not context:
        return None
    root, better, played, opponent, controls, pairs = context
    actual, reply = played["pvUci"][:2]
    ray = chess.Move.from_uci(reply).to_square
    first = played["pvUci"]
    second = [actual, *opponent["pvUci"]]
    supplied = row.get("sharedReply") or {}
    same_reply = supplied.get("line") if (
        supplied.get("betterMoveUci") == better["pvUci"][0]
        and supplied.get("playedMoveUci") == actual
    ) else None
    if not same_reply:
        same_reply = next((line for line in controls if line["pvUci"][0] == reply), None)
    control_prefix = [better["pvUci"][0], reply]
    original = material(root, root.turn)
    single, paired_witness, witnesses = [], [], []
    for pair in pairs:
        recorded_payoffs = list(payments(root, first, ray, pair))
        independent_payoffs = list(payments(root, second, ray, pair))
        if not same_reply or same_reply["pvUci"][0] != reply or same_reply["cp"] is None:
            continue
        if same_reply["depth"] < 16 or abs(-better["cp"] - same_reply["cp"]) > 100:
            continue
        if (opponent["cp"] - same_reply["cp"] < 100 or same_reply["fen"] != prefix(root, control_prefix[:1]).fen()
            or same_reply.get("mate") is not None):
            continue
        control_moves = [better["pvUci"][0], *same_reply["pvUci"]]
        after_legal = prefix(root, control_prefix)
        played_step = chess.Move.from_uci(actual)
        better_step = chess.Move.from_uci(better["pvUci"][0])
        originals = [played_step.from_square if square == played_step.to_square else square for square in pair]
        better_targets = [better_step.to_square if square == better_step.from_square else square for square in originals]
        if any(root.piece_at(origin) != after_legal.piece_at(square) for origin, square in zip(originals, better_targets)):
            continue
        directions = SLIDERS.get(after_legal.piece_type_at(ray), ())
        if any(set(better_targets) == set(other) for other in ray_targets(after_legal, ray, directions)):
            continue
        def maintains_material(horizon):
            if len(control_moves) < horizon:
                return False
            control_at_horizon = prefix(root, control_moves[:horizon])
            return not control_at_horizon.is_check() and material(control_at_horizon, root.turn) >= original - 40

        single.extend(capture for _, ply, capture in recorded_payoffs + independent_payoffs
                      if maintains_material(ply))
        for victim, ply, capture in recorded_payoffs:
            for other, alternative_ply, alternative_capture in independent_payoffs:
                horizon = max(ply, alternative_ply)
                if not maintains_material(horizon):
                    continue
                certificate = dict(
                    firstCapture=capture, secondCapture=alternative_capture,
                    firstHorizon=ply, secondHorizon=alternative_ply, controlHorizon=horizon,
                )
                paired_witness.append(certificate)
                if victim != other and first[2] != second[2]:
                    witnesses.append(certificate)
    return dict(
        id=row["id"], source=row.get("site"), rootFen=root.fen(),
        played=actual, better=better["pvUci"][0], reply=reply,
        pairs=[[chess.square_name(square) for square in pair] for pair in pairs],
        lossCp=better["cp"]-played["cp"],
        paired=dict(cp=played["cp"], san=root.variation_san([chess.Move.from_uci(uci) for uci in first[:9]])),
        independent=dict(cp=-opponent["cp"], san=root.variation_san([chess.Move.from_uci(uci) for uci in second[:9]])),
        control=(
            dict(cp=-same_reply["cp"], san=root.variation_san([
                chess.Move.from_uci(uci) for uci in [better["pvUci"][0], *same_reply["pvUci"][:8]]
            ])) if same_reply else None
        ),
        pairedVictims=[[chess.square_name(square), p, u] for pair in pairs for square, p, u in payments(root, first, ray, pair)],
        independentVictims=[[chess.square_name(square), p, u] for pair in pairs for square, p, u in payments(root, second, ray, pair)],
        oneLine=single[:1],
        twoSearches=paired_witness[:1],
        witnesses=witnesses[:1],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", type=Path, nargs="+")
    args = parser.parse_args()
    results = []
    for path in args.inputs:
        rows = json.loads(path.read_bytes())
        cases = [case for row in rows if (case := preview(row))]
        results.append(dict(file=path.name, sha256=sha256(path.read_bytes()).hexdigest(),
                            count=len(rows), cases=cases))
        print(path.name, len(rows), len(cases))
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
