"""Independently check a compact wN37d strategy using python-chess.

The strategy nominates attacker choices, not legal replies or material values.
This verifier reconstructs both independently, including every evasion of a
checking capture. Local leaves debit legal same-square exchanges and off-square
captures and cover immediate counterchecks. Longer quiet counterplay and unknown
repetition history are outside this finite material certificate, not ruled out.
No engine, production classifier, private corpus or downloads are used.
"""
import json
from pathlib import Path
import chess

VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
         chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 20000}


def after(board, move):
    assert move in board.legal_moves, (board.fen(), move.uci())
    child = board.copy()
    child.push(move)
    return child


def delta(board, move):
    return (100 if board.is_en_passant(move) else VALUE.get(board.piece_type_at(move.to_square), 0)) + (
        VALUE[move.promotion] - 100 if move.promotion else 0)


def exchange(board, move):
    child = after(board, move)
    return delta(board, move) - max([0] + [exchange(child, reply) for reply in child.legal_moves
        if child.is_capture(reply) and reply.to_square == move.to_square])


def static_retention(board, move):
    child = after(board, move)
    if child.is_game_over(claim_draw=True):
        return None
    replies = list(child.legal_moves)
    if any(reply.promotion or after(child, reply).is_checkmate() for reply in replies):
        return None
    liability = max([0] + [exchange(child, reply) for reply in replies
        if child.is_capture(reply) and reply.to_square != move.to_square])
    return delta(board, move) - max(delta(board, move) - exchange(board, move), liability)


def retained(board, move, counts):
    base = static_retention(board, move)
    assert base is not None, (board.fen(), move.uci())
    leaf = after(board, move)
    assert not leaf.is_check(), "No checking capture is accepted as a static leaf"
    for reply in list(leaf.legal_moves):
        checked = after(leaf, reply)
        if not checked.is_check():
            continue
        counts["counterchecks"] += 1
        best = None
        for answer in checked.legal_moves:
            if answer.promotion:
                continue
            answer_board = after(checked, answer)
            # A conservative independent subset suffices for this certificate.
            # Counterchecking answers require another all-evasion tree, not SEE.
            if answer_board.is_check():
                continue
            gain = static_retention(checked, answer)
            if gain is None:
                continue
            earned = delta(board, move) - delta(leaf, reply) + gain
            supported = True
            for second in list(answer_board.legal_moves):
                again = after(answer_board, second)
                if not again.is_check():
                    continue
                captures = []
                for capture in again.legal_moves:
                    if capture.to_square not in again.checkers() or not again.is_capture(capture):
                        continue
                    settled = after(again, capture)
                    if settled.is_check() or any(after(settled, further).is_check()
                                                for further in settled.legal_moves):
                        continue
                    material = static_retention(again, capture)
                    if material is not None:
                        captures.append(delta(board, move) - delta(leaf, reply) + delta(checked, answer)
                                        - delta(answer_board, second) + material)
                if not captures:
                    supported = False
                    break
                earned = min(earned, max(captures))
            if supported:
                best = earned if best is None else max(best, earned)
        assert best is not None, (leaf.fen(), reply.uci())
        base = min(base, best)
    return base


def verify():
    source = json.loads(Path(__file__).with_name("quiet-clearance-strategy.json").read_text())
    cases = []
    for reflected in [False, True]:
        board = chess.Board(source["fen"])
        if reflected:
            board = board.mirror()
        assert board.is_valid()
        flip = lambda square: chess.square_mirror(square) if reflected else square
        move = lambda uci: chess.Move(flip(chess.parse_square(uci[:2])), flip(chess.parse_square(uci[2:4])))
        counts = {"rootReplies": 0, "defenderNodes": 0, "allReplyEdges": 0, "leaves": 0, "counterchecks": 0}

        def defend(position, branches, balance):
            assert not position.is_game_over(claim_draw=True)
            assert {action.uci() for action in position.legal_moves} == {move(uci).uci() for uci in branches}
            counts["defenderNodes"] += 1
            gains = []
            for uci, node in branches.items():
                reply = move(uci)
                counts["allReplyEdges"] += 1
                reached = after(position, reply)
                action = move(node["move"])
                debt = balance - delta(position, reply)
                child = after(reached, action)
                if "replies" in node:
                    gains.append(defend(child, node["replies"], debt + delta(reached, action)))
                else:
                    counts["leaves"] += 1
                    gains.append(debt + retained(reached, action, counts))
            return min(gains)

        root = after(board, move(source["root"]))
        counts["rootReplies"] = root.legal_moves.count()
        bound = defend(root, source["branches"], 0)
        assert bound == source["localBound"] == 180
        # The selected causal witness is specifically the newly opened entry,
        # collecting the separate bishop after the attacked rook has escaped.
        before_entry = move("c7c4")
        assert before_entry not in board.legal_moves
        witness = root
        for uci in ["a4a1", "c7c4", "d4d5", "c4b4"]:
            witness = after(witness, move(uci))
        assert witness.piece_at(flip(chess.B4)).piece_type == chess.ROOK
        # Contrary geometry: the checked king first moves, then Rxb6 is legal.
        contrary = board
        for uci in ["c4b6", "b4d6", "c7c6", "a4a6", "c6d6"]:
            contrary = after(contrary, move(uci))
        assert contrary.is_check()
        assert move("a6b6") not in contrary.legal_moves
        escaped = after(contrary, move("d4c5"))
        escaped.turn = not board.turn
        assert move("a6b6") in escaped.legal_moves
        assert exchange(escaped, move("a6b6")) == 320
        cases.append({"reflected": reflected, "localBoundCp": bound, **counts,
                      "Nb6Contrary": "King evasion makes the formerly illegal Rxb6 liability available"})
    return {"scope": "Independent finite local material verification, not whole-game WDL", "cases": cases}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
