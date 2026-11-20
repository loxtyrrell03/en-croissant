"""Compare the loss of a legal defensive capture with its observed outcome."""

import argparse
from collections import Counter
import json
from pathlib import Path

import chess

from gather import digest, initial, track_move

VALUES = (0, 100, 320, 330, 500, 900, 0)
PAWN = chess.PAWN


def points(board, side):
    return sum(VALUES[p.piece_type] * (1 if p.color == side else -1)
               for p in board.piece_map().values())


def score(row):
    if row["mate"] is not None:
        return (10_000 - abs(row["mate"])) * (1 if row["mate"] > 0 else -1)
    return row["cp"]


def replay(root, switches, line, limit=23):
    board = root.copy()
    mover = root.turn
    baseline = points(root, mover)
    where = {square: square for square in root.piece_map()}
    snapshots, losses, sans = [], {}, []
    for i, uci in enumerate([*switches, *line][:limit], 1):
        move = board.parse_uci(uci)
        victim = track_move(board, move, where)
        if victim is not None:
            losses[victim] = i
        sans.append(board.san(move))
        board.push(move)
        snapshots.append(dict(board=board.copy(stack=False), where=where.copy(),
                              balance=points(board, mover) - baseline, move=uci))
    mate = board.is_checkmate()
    return dict(trace=snapshots, losses=losses, sans=sans,
                mateAgainst=mover == board.turn if mate else False)


def sustained(capture, worse, start, root):
    shared_losses = {origin for origin in worse[0]["losses"]
                     if root.color_at(origin) == root.turn and root.piece_type_at(origin) != chess.KING}
    for trace in worse[1:]:
        shared_losses.intersection_update(trace["losses"])
    losses = [(origin, max(trace["losses"][origin] for trace in worse)) for origin in shared_losses
              if all(trace["losses"][origin] > start for trace in worse)]
    bounds = [len(trace["trace"]) for trace in [capture, *worse]]
    for victim, lost in sorted(losses, key=lambda item: (item[1], -VALUES[root.piece_type_at(item[0])])):
        for end in range(lost + 2, min(lost + 6, *bounds) + 1):
            # Track the net loss and any compensation through the same
            # absolute ply, rather than at unrelated ends of the PVs.
            balance = lambda trace: [step["balance"] for step in trace["trace"][end - 3:end]]
            defended = min(balance(capture))
            actual = max(max(balance(trace)) for trace in worse)
            if defended - actual < 90 or actual > -90:
                continue
            if victim in capture["losses"] and capture["losses"][victim] <= end:
                return dict(victim=chess.square_name(victim), role=root.piece_at(victim).symbol(),
                            alsoTradedInDefence=True, throughPly=end, materialDifferenceCp=defended - actual)
            return dict(victim=chess.square_name(victim), role=root.piece_at(victim).symbol(),
                        alsoTradedInDefence=False, throughPly=end, materialDifferenceCp=defended - actual)


def passer_position(trace, count, origin):
    steps = trace["trace"]
    if count > len(steps):
        return None
    after = steps[count - 1]
    square = next((sq for sq, identity in after["where"].items() if identity == origin), None)
    if square is None:
        return None
    piece = after["board"].piece_at(square)
    return square, piece, after["board"]


def pressure(row, root, bad):
    """A different verification of the same persistent pawn, before conversion."""
    foe = not root.turn
    stronger = [replay(root, [], row[key]) for key in ("rootBetter", "replyBetter")]
    width = 12
    for origin in root.pieces(PAWN, foe):
        file, rank = chess.square_file(origin), chess.square_rank(origin)
        ahead = (lambda sq: chess.square_rank(sq) > rank) if foe else (lambda sq: chess.square_rank(sq) < rank)
        if (rank if foe else 7 - rank) < 4 or any(
            abs(chess.square_file(sq) - file) <= 1 and ahead(sq) for sq in root.pieces(PAWN, root.turn)
        ):
            continue
        advances = []
        for trace in bad:
            reached = None
            for ply in range(len(row["prefix"]) + 2, min(width, len(trace["trace"]) - 2)):
                state = passer_position(trace, ply, origin)
                if not state:
                    break
                sq, piece, board = state
                if piece.piece_type != PAWN or chess.square_rank(sq) != (6 if foe else 1) or sq == origin:
                    continue
                # The pawn reaches the seventh with active support and
                # survives the next two plies, or promotes in that window.
                follow = passer_position(trace, ply + 2, origin)
                if board.attackers(foe, sq) and follow:
                    reached = (sq, ply)
                    break
            if reached:
                advances.append(reached)
        if len(advances) != len(bad) or len({square for square, _ in advances}) != 1:
            continue
        last = max(ply for _, ply in advances) + 2
        if any(len(trace["trace"]) < last for trace in stronger):
            continue
        at_last = [passer_position(trace, last, origin) for trace in stronger]
        if not all(state is None for state in at_last):
            continue
        # Taking the original pawn must be economical in both stronger
        # lines. A rook sacrificed to stop promotion does not count.
        clean = []
        for trace in stronger:
            capture_ply = trace["losses"].get(origin)
            if capture_ply is None or capture_ply + 1 >= len(trace["trace"]):
                break
            previous = trace["trace"][capture_ply - 2]["balance"] if capture_ply > 1 else 0
            if min(s["balance"] for s in trace["trace"][capture_ply - 1:capture_ply + 2]) < previous:
                break
            clean.append(capture_ply)
        if len(clean) == 2:
            return dict(original=chess.square_name(origin), advanced=chess.square_name(advances[0][0]),
                        throughPly=last, removalPlies=clean)


def inspect(row, arm="full"):
    root = initial(row)
    outputs = (row["betterSearch"], row["playedSearch"], row["captureSearch"], row["deniedSearch"])
    required = list(outputs[:3]) if arm == "full" else list(outputs[1:3]) if arm == "targeted" else [outputs[2]]
    if not all(required) or any(lines[0]["depth"] < 16 for lines in required):
        return dict(id=row["id"], stage="incomplete")
    best = outputs[0][0] if outputs[0] else None
    bad = outputs[1][0] if outputs[1] else None
    defensive = outputs[2][0]
    capturable = score(best) - 55 if arm == "full" else row["betterCp"] - 75
    if score(defensive) < capturable:
        return dict(id=row["id"], stage="capture-does-not-hold")
    poor_score = row["playedCp"] if arm == "cached" else score(bad)
    if score(defensive) - poor_score < 100 or abs(poor_score - row["playedCp"]) > 125:
        return dict(id=row["id"], stage="reached-result-does-not-repeat")
    capture = replay(root, [row["better"], *row["prefix"]], defensive["pvUci"])
    known_bad = [replay(root, [], row[key]) for key in ("rootWorse", "replyWorse")]
    repeated = known_bad[-1] if arm == "cached" else replay(root, [row["played"], *row["prefix"]], bad["pvUci"])
    branches = known_bad if arm == "cached" else [*known_bad, repeated]
    start = len(row["prefix"]) + 1
    outcome = sustained(capture, branches, start, root)
    if not outcome:
        return dict(id=row["id"], stage="no-repeated-material-consequence")
    positional = pressure(row, root, branches)
    necessity = False
    if arm == "full" and outputs[3] and score(defensive) - score(outputs[3][0]) >= 100:
        restricted = replay(root, [row["better"], *row["prefix"]], outputs[3][0]["pvUci"])
        other = sustained(capture, [*branches, restricted], start, root)
        necessity = bool(other and other["victim"] == outcome["victim"])
    through = outcome["throughPly"]
    return dict(id=row["id"], stage="defence-verified", tactical=outcome, positional=positional,
                removingCaptureReproducesOutcome=necessity,
                reachedScores=[score(best) if best else None, poor_score, score(defensive)],
                betterLine=capture["sans"][:through], playedLine=repeated["sans"][:through])


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("frames", type=Path)
    cli.add_argument("output", type=Path)
    cli.add_argument("--arm", choices=("full", "targeted", "cached"), default="full")
    args = cli.parse_args()
    source = json.loads(args.frames.read_bytes())
    results = [inspect(row, args.arm) for row in source["cases"]]
    totals = Counter(row["stage"] for row in results)
    totals["verifiedMixed"] = sum(bool(row.get("positional")) for row in results)
    totals["outcomeAfterRemovingCaptures"] = sum(bool(row.get("removingCaptureReproducesOutcome")) for row in results)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(framesSha256=digest(args.frames), counts=totals, cases=results), stream, indent=2)
    print(totals)


if __name__ == "__main__":
    main()
