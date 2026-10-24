"""Independent legal and finite tactical witnesses for the fixed public sample.

No production classifier, engine, owner store or remote provider is called.
Local capture retention is not an exact full-game evaluation. The altered
bishop-development history is constructed, not the recorded game continuation.
"""
import json
from pathlib import Path
import chess

BASE = Path(__file__).parent
VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
          chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 20000}


def play(board, uci):
    move = board.parse_uci(uci)
    assert move in board.legal_moves
    child = board.copy()
    child.push(move)
    return child


def delta(board, move):
    return (100 if board.is_en_passant(move) else VALUES.get(board.piece_type_at(move.to_square), 0)) + (
        VALUES[move.promotion] - 100 if move.promotion else 0)


def exchange(board, move):
    child = play(board, move.uci())
    return delta(board, move) - max([0] + [exchange(child, reply) for reply in child.legal_moves
        if child.is_capture(reply) and reply.to_square == move.to_square])


def verify():
    sources = [json.loads((BASE / name).read_text()) for name in [
        "ordinary-precision-v1-selection.json", "ordinary-precision-v1-adjacent-selection.json"]]
    cases = [row for source in sources for row in source["cases"]]
    for row in cases:
        board = chess.Board(row["history"]["fen"])
        for uci in row["history"]["moves"]:
            assert not board.is_game_over(claim_draw=False)
            board = play(board, uci)
        assert board.fen() == row["fen"], (row["id"], board.fen(), row["fen"])
        for alternative in row["quietAlternatives"]:
            move = board.parse_uci(alternative["uci"])
            assert not board.is_capture(move)
            assert not play(board, alternative["uci"]).is_check()
        for uci in row["sourceUci"]:
            board = play(board, uci)
    witnessed = []
    for reflected in [False, True]:
        def flip(uci):
            move = chess.Move.from_uci(uci)
            return chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square)).uci() if reflected else uci

        def reflected_board(fen):
            board = chess.Board(fen)
            return board.mirror() if reflected else board

        mate_row = next(row for row in cases if row["id"] == "context:QZDg7vtX:ply45")
        board = reflected_board(mate_row["fen"])
        root_side = board.turn
        assert {move.uci() for move in board.legal_moves} == {flip("g8h8")}
        board = play(board, flip("g8h8"))
        assert board.turn != root_side
        checked = play(board, flip("f7f8"))
        assert {move.uci() for move in checked.legal_moves} == {flip("b8f8")}
        final = play(play(checked, flip("b8f8")), flip("f1f8"))
        assert final.is_checkmate()
        witnessed.append({"kind": "opponent-only-forced-mate", "reflected": reflected,
            "rootReplyCount": 1, "matingMoveDefences": 1, "ending": "checkmate"})

        pawn_row = next(row for row in cases if row["id"] == "context:Z1Tw5YR3:ply16")
        root = reflected_board(pawn_row["fen"])
        taken = play(root, flip("b5c7"))
        recaptures = [move for move in taken.legal_moves if move.to_square == chess.Move.from_uci(flip("b5c7")).to_square]
        assert {move.uci() for move in recaptures} == {flip("d8c7")}
        recovered = play(taken, flip("d8c7"))
        assert chess.Move.from_uci(flip("f4c7")) in recovered.legal_moves
        assert exchange(taken, recaptures[0]) == -580
        liabilities = [exchange(taken, move) for move in taken.legal_moves if taken.is_capture(move)]
        assert max([0] + liabilities) == 0
        checks = []
        for reply in list(taken.legal_moves):
            child = play(taken, reply.uci())
            if not child.is_check():
                continue
            gains = [exchange(child, answer) for answer in child.legal_moves if child.is_capture(answer)]
            best = max(gains)
            assert 100 - delta(taken, reply) + best >= 100
            checks.append({"uci": reply.uci(), "retentionAtLeast": 100 - delta(taken, reply) + best})
        assert len(checks) == 2
        alternate_history = ["c1g5" if uci == "c1f4" else uci for uci in pawn_row["history"]["moves"]]
        assert alternate_history != pawn_row["history"]["moves"]
        alternative = chess.Board(pawn_row["history"]["fen"])
        for uci in alternate_history:
            alternative = play(alternative, uci)
        if reflected:
            alternative = alternative.mirror()
        bad_capture = play(alternative, flip("b5c7"))
        refutation = chess.Move.from_uci(flip("d8c7"))
        assert exchange(bad_capture, refutation) == 320
        witnessed.append({"kind": "protected-pawn-capture", "reflected": reflected,
            "legalRecaptures": [move.uci() for move in recaptures], "queenRecaptureNet": -580,
            "immediateProfitableCountercapture": False, "counterchecks": checks,
            "alteredHistory": "Earlier Bf4 replaced by legal Bg5; Qxc7 wins the knight",
            "alteredHistoryNetFromNxc7": 100 - exchange(bad_capture, refutation)})
    return {"scope": "Independent legal replay and finite checking/capture witnesses; not population or full-game accuracy",
        "legalContexts": len(cases), "witnesses": witnessed}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
