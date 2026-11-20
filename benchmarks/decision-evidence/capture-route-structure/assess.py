"""Test a specific positional claim against the legally available capture order."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

import chess

from freeze import capture_target, digest, quiet_check, write

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "defence-after-attack"))
from gather import finite, initial


HORIZON = 6
PREFERENCE = 40
NEAR = 35
CONSISTENCY = 90
PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def score_gap(lines):
    if len(lines) < 2 or any(not finite(line) for line in lines):
        return None
    return lines[0]["cp"] - lines[1]["cp"]


def pawn_edges(board, origin):
    pawns = board.pieces(chess.PAWN, board.turn)
    forward = {(origin, target) for target in board.attacks(origin) & pawns}
    backward = {(source, origin) for source in board.attackers(board.turn, origin) & pawns}
    return forward | backward


def material(position, side):
    return sum(value * (len(position.pieces(piece, side)) - len(position.pieces(piece, not side)))
               for piece, value in PIECE_VALUES.items())


def variation(board, uci):
    return board.variation_san([chess.Move.from_uci(move) for move in uci[:HORIZON + 2]])


def exchange_square(board, move):
    if not board.is_capture(move):
        return None
    if board.is_en_passant(move):
        return move.to_square + (-8 if board.turn else 8)
    return move.to_square


def line_end(board, pv, edge=None, settle=False):
    if len(pv) < HORIZON:
        return None
    child = board.copy()
    side = child.turn
    last_capture = None
    for index, uci in enumerate(pv[:HORIZON + (2 if settle else 0)]):
        move = chess.Move.from_uci(uci)
        if not child.is_legal(move):
            raise ValueError(f"Illegal continuation {uci} after {child.fen()}")
        capture = exchange_square(child, move)
        if index >= HORIZON and (last_capture is None or capture != last_capture):
            break
        last_capture = move.to_square if capture is not None else None
        child.push(move)
        if edge and any(child.piece_at(square) != chess.Piece(chess.PAWN, side) for square in edge):
            return None
    return child


def reaches(board, pv, target):
    if len(pv) < 3:
        return False
    return capture_target(board, *(chess.Move.from_uci(move) for move in pv[:3])) == target


def frame(row, item):
    checking, direct = item["pair"]
    root = {line["pvUci"][0]: line for line in item["lines"]}
    reply = {probe["moveUci"]: probe["lines"] for probe in row["replyProbes"]}
    if not all(uci in root and uci in reply for uci in (checking, direct)):
        return None
    check, pawn = (root[uci] for uci in (checking, direct))
    responses, pawn_replies = (reply[uci] for uci in (checking, direct))
    if (check["depth"] != pawn["depth"] or len(responses) != 2
            or score_gap(responses) is None
            or any(not finite(line) for line in (check, pawn, pawn_replies[0]))
            or not row["candidates"] or not finite(row["candidates"][0])):
        return None
    return check, pawn, responses, pawn_replies[0]


def examine(board, row, item, settle=False):
    check_uci, pawn_uci = item["pair"]
    checking, direct = [chess.Move.from_uci(uci) for uci in item["pair"]]
    if (not quiet_check(board, checking) or not board.is_legal(checking)
            or not board.is_legal(direct) or not board.is_capture(direct)
            or board.piece_type_at(direct.from_square) != chess.PAWN):
        raise ValueError(f"Not a legal exact pair for {row['id']}.")
    edges = pawn_edges(board, direct.from_square)
    lines = frame(row, item)
    if lines is None:
        return dict(status="uncertain", broad=False, why="incomplete engine frame")
    check, pawn, responses, pawn_response = lines
    root_preference = check["cp"] - pawn["cp"]
    reply_preference = pawn_response["cp"] - responses[0]["cp"]
    lead_gap = row["candidates"][0]["cp"] - check["cp"]
    target = direct.to_square
    root_reaches = reaches(board, check["pvUci"], target)
    broad = root_reaches and lead_gap <= NEAR and root_preference >= PREFERENCE
    result = dict(broad=broad, leadGapCp=lead_gap, rootPreferenceCp=root_preference,
                  replyPreferenceCp=reply_preference,
                  rootSan=variation(board, check["pvUci"]),
                  pawnSan=variation(board, pawn["pvUci"]),
                  checkReplySan=variation(board, [check_uci, *responses[0]["pvUci"]]),
                  pawnReplySan=variation(board, [pawn_uci, *pawn_response["pvUci"]]))

    def verdict(status, why, **observations):
        return dict(result, status=status, why=why, **observations)

    if not edges:
        return verdict("negative", "the pawn has no original pawn support link")
    if root_preference <= -PREFERENCE and reply_preference <= -PREFERENCE:
        return verdict("negative", "both comparisons favour the direct pawn capture")
    if max(abs(check["cp"] + responses[0]["cp"]), abs(pawn["cp"] + pawn_response["cp"])) > CONSISTENCY:
        return verdict("uncertain", "reached-position scores disagree")
    if not broad or reply_preference < PREFERENCE:
        return verdict("uncertain", "insufficient support for the checking route")

    check_paths = [check["pvUci"], *[[check_uci, *line["pvUci"]] for line in responses
                                      if responses[0]["cp"] - line["cp"] <= NEAR]]
    pawn_paths = [pawn["pvUci"], [pawn_uci, *pawn_response["pvUci"]]]
    if any(not reaches(board, pv, target) for pv in check_paths):
        return verdict("negative", "an independent competitive reply changes the captured unit")
    rich = [line_end(board, pv, settle=settle) for pv in check_paths]
    plain = [line_end(board, pv, settle=settle) for pv in pawn_paths]
    if any(position is None for position in [*rich, *plain]):
        return verdict("uncertain", "short continuation")
    values = [material(position, board.turn) for position in [*rich, *plain]]
    if max(values) - min(values) > 1:
        return verdict("uncertain", "material differences confound the structural comparison")
    for source, neighbour in sorted(edges):
        if all(line_end(board, pv, (source, neighbour), settle=settle) is not None for pv in check_paths):
            return verdict("positive", "the original pawn support persists through the alternative capture",
                           support=[chess.square_name(source), chess.square_name(neighbour)],
                           materialByLine=values)
    return verdict("negative", "the original pawn support does not persist through the check")


def assess(row, settle=False):
    board = initial(row)
    usual_replies = {line["pvUci"][0] for line in row["candidates"][:2]} | {row["playedMoveUci"]}
    return [dict(examine(board, row, item, settle=settle), pair=item["pair"],
                 extraRoot=item["targeted"],
                 extraReplies=[move for move in item["pair"] if move not in usual_replies])
            for item in row["pairFrames"]]


def summary(rows):
    totals = Counter()
    for row in rows:
        reference = row["reference"]
        status = next((outcome for outcome in ("positive", "uncertain", "negative")
                       if any(item["status"] == outcome for item in reference)), "uncertain")
        totals[f"reference {status}"] += 1
        for arm, observed, accepts in (
            ("shortlist pattern", "app", lambda item: not item["extraRoot"] and item["broad"]),
            ("cached fixed horizon", "app", lambda item: cached(item) and item["status"] == "positive"),
            ("cached settled exchange", "settled", lambda item: cached(item) and item["status"] == "positive"),
            ("targeted settled exchange", "settled", lambda item: item["status"] == "positive"),
        ):
            picks = [item for item in row[observed] if accepts(item)]
            if not picks:
                continue
            exact = [ref["status"] for ref in reference if any(ref["pair"] == item["pair"] for item in picks)]
            # Give credit for a precise pair only. A different pawn capture
            # on the same decision can have a different explanation.
            outcome = ("positive" if "positive" in exact else "uncertain"
                       if "uncertain" in exact or not exact else "negative")
            totals[f"{arm} {outcome}"] += 1
    return dict(totals)


def cached(item):
    return not item["extraRoot"] and not item["extraReplies"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "reference", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    app, reference = [json.loads(path.read_bytes()) for path in (args.app, args.reference)]
    if [row["id"] for row in app] != [row["id"] for row in reference]:
        raise ValueError("Capture frames use different decision sets.")
    rows = [dict(id=x["id"], mode=x.get("mode", "calibration"), site=x["site"], fen=x["fen"],
                 app=assess(x), settled=assess(x, settle=True),
                 reference=assess(y, settle=True)) for x, y in zip(app, reference)]
    totals = summary(rows)
    write(args.output, dict(totals=totals, inputs=[digest(path.read_bytes()) for path in
                                                  (args.app, args.reference)], cases=rows))
    print(totals, flush=True)


if __name__ == "__main__":
    main()
