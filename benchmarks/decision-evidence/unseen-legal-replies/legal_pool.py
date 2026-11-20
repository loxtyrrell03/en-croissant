"""Enumerate questions not in the cached engine continuations."""

from dataclasses import asdict
from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path.cwd() / "benchmarks/decision-evidence/defender-capture-order"))
from capture_order import Candidate, ordinary_capture, score
from trials import initial, within


VALUE = (0, 1, 3.2, 3.3, 5, 9, 0)


def piece_features(board, square):
    role = board.piece_type_at(square)
    return [float(role == piece) for piece in chess.PIECE_TYPES]


def static(board, move):
    victim = board.piece_type_at(move.to_square)
    return VALUE[victim] if victim else float(board.is_en_passant(move))


def features(before, after, reached, direct, root, reply, guard_capture, take, lead_cp, root_cp, rank):
    guard = guard_capture.to_square
    target = take.to_square
    side = reached.turn
    our_king = reached.king(side)
    rep_gain = static(after, reply)
    return [
        float(rank), root_cp / 100, (lead_cp - root_cp) / 100,
        float(after.gives_check(reply)), rep_gain, float(reply.to_square == guard),
        static(reached, guard_capture), static(reached, take), VALUE[reached.piece_type_at(take.from_square)],
        float(reached.gives_check(take)), float(direct.is_check()),
        float(direct.is_legal(chess.Move(guard, root.to_square))),
        chess.square_distance(reply.from_square, reply.to_square),
        chess.square_distance(root.from_square, root.to_square),
        chess.square_distance(guard, our_king), chess.square_distance(target, our_king),
        len(reached.attackers(side, target)), len(reached.attackers(not side, target)),
        len(reached.attackers(side, guard)), len(reached.attackers(not side, guard)),
        len(direct.attackers(side, target)), len(direct.attackers(not side, target)),
        float(reached.is_pinned(side, take.from_square)), float(reached.is_pinned(not side, guard)),
        *piece_features(before, root.from_square), *piece_features(after, reply.from_square),
        *piece_features(reached, guard), *piece_features(reached, take.from_square), *piece_features(reached, target),
    ]


def available_roots(row):
    lines = row["candidates"]
    if not lines or score(lines[0]) is None:
        return
    paired = row.get("comparisonCandidates") or []
    for rank, line in enumerate(lines):
        cp = score(line)
        if cp is None or line["mate"] is not None or not within(lines, line["pvUci"][0], 50):
            continue
        uci = line["pvUci"][0]
        if within(paired, uci, 50) is False:
            continue
        probe = next((item["lines"] for item in row.get("replyProbes", []) if item["moveUci"] == uci), [])
        if not probe or score(probe[0]) is None or probe[0]["mate"] is not None or abs(cp + probe[0]["cp"]) > 90:
            continue
        visible = {item["pvUci"][0] for item in probe if item["pvUci"]}
        visible.update(line["pvUci"][1:2])
        yield rank, line, visible, probe[0]["pvUci"][0]


def order_questions(row):
    board = initial(row)
    if board.is_check():
        return
    for rank, line, visible, leading in available_roots(row):
        root = board.parse_uci(line["pvUci"][0])
        if board.is_capture(root) or board.gives_check(root) or root.promotion or board.is_castling(root):
            continue
        after = board.copy(stack=False)
        after.push(root)
        for reply in sorted(after.legal_moves, key=chess.Move.uci):
            if after.is_castling(reply) or after.is_en_passant(reply) or reply.promotion:
                continue
            reached = after.copy(stack=False)
            reached.push(reply)
            options = [move for move in reached.legal_moves if ordinary_capture(reached, move)]
            guards = []
            for remove in options:
                if remove.from_square != root.to_square or reached.gives_check(remove):
                    continue
                guard = remove.to_square
                old = reply.from_square if reply.to_square == guard else guard
                if not board.piece_at(old) or not board.is_legal(chess.Move(root.from_square, old)):
                    guards.append(remove)
            if not guards:
                continue
            for take in options:
                if take.from_square == root.to_square:
                    continue
                direct = reached.copy(stack=False)
                direct.push(take)
                for remove in guards:
                    guard = remove.to_square
                    if take.to_square == guard or not direct.is_legal(chess.Move(guard, take.to_square)):
                        continue
                    proposal = Candidate(root.uci(), reply.uci(), remove.uci(), take.uci(), guard, take.to_square, root.to_square)
                    yield dict(
                        proposal=asdict(proposal), unseen=proposal.reply not in visible,
                        knownReply=leading, evalCp=line["cp"],
                        features=features(board, after, reached, direct, root, reply, remove, take,
                                          row["candidates"][0]["cp"], line["cp"], rank),
                    )


def material_order(item):
    features = item["features"]
    return features[8] - features[7], features[6], features[7], -features[0]
