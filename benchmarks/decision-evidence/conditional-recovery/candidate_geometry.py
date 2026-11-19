from pathlib import Path
import importlib.util
import chess

repo = Path("benchmarks/decision-evidence")
spec = importlib.util.spec_from_file_location("recovery", repo / "tactical-recovery" / "recovery.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def reliable(line):
    return line and line["cp"] is not None and line["depth"] >= 16 and line.get("mate") is None


def cp_frame(row, scope):
    better = row["candidates"][0]
    roots = row.get("comparisonCandidates") if scope == "mistake" else row["candidates"]
    if not roots or not reliable(better) or roots[0]["pvUci"][0] != better["pvUci"][0]:
        return
    if not reliable(roots[0]):
        return
    better = roots[0]
    played_uci = row.get("playedMoveUci")
    probes = {p["moveUci"]:p["lines"] for p in row.get("replyProbes", []) + row.get("referenceReplies", []) if p["lines"]}
    for alt in roots[1:]:
        if scope == "mistake" and alt["pvUci"][0] != played_uci:
            continue
        if not reliable(alt) or better["depth"] != alt["depth"] or better["cp"] - alt["cp"] < 100 or len(alt["pvUci"]) < 2:
            continue
        already = probes.get(alt["pvUci"][0]) or []
        if scope == "mistake" and (not already or not reliable(already[0]) or abs(alt["cp"] + already[0]["cp"]) > 90
                                   or alt["pvUci"][1] != already[0]["pvUci"][0]):
            continue
        yield better, alt, probes.get(better["pvUci"][0], []), already


def branch(root, root_move, response):
    board = root.copy(stack=False)
    move = board.parse_uci(root_move)
    board.push(move)
    reply = chess.Move.from_uci(response)
    if reply not in board.legal_moves or not board.is_capture(reply):
        return None, None
    target = reply.to_square + ((-8 if board.turn else 8) if board.is_en_passant(reply) else 0)
    origin = move.from_square if move.to_square == target else target
    board.push(reply)
    return board, origin


def nominate(row, scope):
    root = chess.Board(row["fen"])
    for better, weaker, good_replies, bad_replies in cp_frame(row, scope):
        response = weaker["pvUci"][1]
        bad, bvictim = branch(root, weaker["pvUci"][0], response)
        good, gvictim = branch(root, better["pvUci"][0], response)
        if bad is None or good is None or bvictim != gvictim:
            continue
        novel, gated = [], []
        for answer in good.legal_moves:
            if answer in bad.legal_moves:
                continue
            piece = good.piece_at(answer.from_square)
            if good.piece_at(answer.from_square) != bad.piece_at(answer.from_square):
                evidence = "relocation"
            elif bad.is_pinned(good.turn, answer.from_square) and not good.is_pinned(good.turn, answer.from_square):
                evidence = "unpin"
            elif piece.piece_type == chess.KING:
                evidence = "king-escape"
            elif good.is_capture(answer) or good.gives_check(answer):
                evidence = "forcing-answer"
            else:
                evidence = "quiet-answer"
            novel.append((answer.uci(), evidence))
            if evidence in ("unpin", "king-escape"):
                gated.append((answer.uci(), evidence))
        if not novel:
            continue
        known = next((p for p in good_replies if reliable(p) and p["pvUci"][0]==response), None)
        yield {
            "id":row["id"], "scope":scope, "better":better["pvUci"][0], "weaker":weaker["pvUci"][0], "sameReply":response,
            "commonVictim":chess.square_name(bvictim), "novel":novel, "gated":gated,
            "strictRoots":better["pvUci"][1:2]==[response],
            "gap":better["cp"]-weaker["cp"], "cachedReply":known, "already": bool(bad_replies),
            "fen": row["fen"], "history": row.get("history"),
            "betterRoot":better,"playedRoot":weaker,"betterReplies":good_replies,"playedReplies":bad_replies,
        }
