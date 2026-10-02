"""Finite independent chess rules and material witnesses; no engine or strategy oracle."""
import argparse
import hashlib
import json
from pathlib import Path
import chess

VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def material(board, side):
    return sum(VALUES[piece.piece_type] * (1 if piece.color == side else -1)
               for piece in board.piece_map().values())


def play(board, uci):
    move = chess.Move.from_uci(uci)
    assert move in board.legal_moves, (board.fen(), uci)
    result = board.copy(stack=False)
    result.push(move)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    base = Path(__file__).resolve().parent
    raw = (base / "quiet-trap-adversarial-selection.json").read_bytes()
    selected = [row for row in json.loads(raw)["cases"] if row["id"] in ["lichess:gMkbY", "lichess:9YfbQ"]]
    observations = []
    for row in selected:
        for reflected in [False, True]:
            m = lambda uci: "".join(str(9 - int(c)) if c in "12345678" else c for c in uci) if reflected else uci
            before = chess.Board(row["startFen"])
            if reflected:
                before = before.mirror()
            assert before.is_valid()
            root = play(before, m(row["bestLine"][0]))
            accounting = []
            current = before
            for move in row["bestLine"]:
                current = play(current, m(move))
                accounting.append(material(current, before.turn) - material(before, before.turn))
            replies = []
            for reply in root.legal_moves:
                after = play(root, reply.uci())
                entry = {"uci": reply.uci(), "san": root.san(reply), "check": after.is_check()}
                if row["id"].endswith("9YfbQ"):
                    promotion = chess.Move.from_uci(m("e2e1q"))
                    if promotion in after.legal_moves:
                        promoted = play(after, promotion.uci())
                        entry.update({"promotionMate": promoted.is_checkmate(), "checkingPieces": [chess.square_name(square) for square in promoted.checkers()]})
                replies.append(entry)
            if row["id"].endswith("gMkbY"):
                assert len(replies) == 30
                assert accounting == [0, -320, 10, -490, 410]
                fork = play(play(root, m("h5h4")), m("g5f3"))
                assert fork.is_check()
                fork_answers = []
                for reply in fork.legal_moves:
                    after = play(fork, reply.uci())
                    collectors = [candidate.uci() for candidate in after.legal_moves if candidate.to_square == chess.parse_square(m("h4"))]
                    assert collectors
                    fork_answers.append({"reply": reply.uci(), "queenCollectors": collectors})
                no_rook = before.copy(stack=False)
                no_rook.remove_piece_at(chess.parse_square(m("h8")))
                escaped = no_rook
                for move in ["g7g6", "c1g5", "h6g5", "h5h7"]:
                    escaped = play(escaped, m(move))
                queen = chess.parse_square(m("h7"))
                assert not any(move.to_square == queen for move in escaped.legal_moves)
                blocked = before.copy(stack=False)
                blocked.set_piece_at(chess.parse_square(m("f6")), chess.Piece(chess.PAWN, not before.turn))
                assert blocked.is_valid()
                for move in ["g7g6", "h5h4", "g5f3", "g2f3"]:
                    blocked = play(blocked, m(move))
                queen = chess.parse_square(m("h4"))
                assert not any(move.to_square == queen for move in blocked.legal_moves)
                extras = {"Qh4CheckingForkAllEvasions": fork_answers, "missingRookQh7HasNoImmediateLegalCapturer": True, "extraF6PawnBlocksDiscoveredQueenCollectorAfterGxf3": True}
            else:
                assert len(replies) == 39
                assert accounting == [0, 0, 500, -400, -400, -400, -300]
                mate = play(play(root, m("c1a1")), m("e2e1q"))
                assert mate.is_checkmate()
                assert len(mate.checkers()) == 2
                original_threat = play(before, m("e2e1q"))
                assert not original_threat.is_checkmate()
                assert chess.Move.from_uci(m("h1e1")) in original_threat.legal_moves
                no_pawn = before.copy(stack=False)
                no_pawn.remove_piece_at(chess.parse_square(m("e2")))
                no_pawn_root = play(no_pawn, m("d8d2"))
                assert no_pawn_root.is_check()
                reversed_capture = play(before, m("d1c1"))
                assert chess.Move.from_uci(m("f4c1")) in reversed_capture.legal_moves
                original_guard_recovery = play(reversed_capture, m("f4c1"))
                assert material(original_guard_recovery, before.turn) - material(before, before.turn) == -400
                reverse_rook = original_guard_recovery
                for move in ["d8d1", "h1d1", "e2d1q", "c1d1"]:
                    reverse_rook = play(reverse_rook, m(move))
                assert material(reverse_rook, before.turn) - material(before, before.turn) == -500
                prepared = play(play(root, m("f2g3")), m("d1c1"))
                assert chess.Move.from_uci(m("f4c1")) not in prepared.legal_moves
                assert chess.Move.from_uci(m("h1c1")) in prepared.legal_moves
                offered = play(play(root, m("f4d2")), m("d1d2"))
                assert material(offered, before.turn) - material(before, before.turn) == 400
                extras = {"Ra1AllowsPromotionDoubleCheckmate": True, "immediatePromotionBeforeRd2AllowsRh1xe1": True, "pawnRemovedRootBecomesCheckDifferentMechanism": True, "directQxc1PermitsQf4xc1": True, "Rd2BlocksThatExactQueenRecapture": True, "Qxd2Qxd2LocalGain": 400, "directQxc1Qxc1Rd1Rxd1exd1QQxd1LocalGain": -500}
            observations.append({"id": row["id"], "reflected": reflected, "fen": before.fen(), "sourceAccounting": accounting, "replies": replies, **extras})
    result = {"schemaVersion": 1, "checker": f"python-chess {chess.__version__}", "scope": "Exact legal-move and finite material/geometry witnesses only, not an all-defence strategic proof.", "sourceSha256": hashlib.sha256(raw).hexdigest(), "observations": observations}
    with Path(args.output).open("x", encoding="utf8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"rows": len(observations), "allRootReplies": sum(len(row["replies"]) for row in observations), "scope": result["scope"]}))


if __name__ == "__main__":
    main()
