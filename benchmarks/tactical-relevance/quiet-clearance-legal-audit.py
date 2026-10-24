"""Independent legal/ledger witnesses, deliberately not a root minimax proof."""
import argparse
import json
import chess

ROOTS = {
    "2qDuS": "rn4k1/3b2pp/3p4/pq5Q/4NB2/3P4/Pb4PP/4R1K1 w - - 0 25",
    "3LtAI": "r1b1kb1r/ppppqppp/8/n1nPN3/8/3B4/PPP2PPP/RNBQK2R w KQkq - 1 8",
}
VALUE = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
         chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def replay(ident, line, reflected):
    board = chess.Board(ROOTS[ident])
    if reflected:
        board = board.mirror()
    start = board.fen()
    side = board.turn
    balance = 0
    trace = []
    for uci in line.split():
        move = chess.Move.from_uci(uci)
        if reflected:
            move = chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion)
        assert move in board.legal_moves, (board.fen(), move.uci())
        victim = board.piece_at(move.to_square)
        balance += (VALUE[victim.piece_type] if victim else 0) * (1 if board.turn == side else -1)
        san = board.san(move)
        board.push(move)
        trace.append({"uci": move.uci(), "san": san, "balance": balance, "fen": board.fen()})
    return board, {"id": ident, "reflected": reflected, "rootFen": start, "trace": trace,
                   "replyUci": sorted(move.uci() for move in board.legal_moves)}


def run():
    rows = []
    for reflected in [False, True]:
        for ident, move, replies in [("2qDuS", "e4g5", 38), ("3LtAI", "e1g1", 30)]:
            board, row = replay(ident, move, reflected)
            assert board.legal_moves.count() == replies
            row["scope"] = "Complete legal root-reply inventory, no claimed answer strategy"
            rows.append(row)
        board, row = replay("2qDuS", "e4g5 b5f5 e1e8 d7e8 h5e8", reflected)
        assert board.is_check() and not board.is_checkmate()
        assert board.legal_moves.count() == 1
        row["scope"] = "Qxe8+ is not mate; queen interposition remains legal"
        rows.append(row)
        board, row = replay("3LtAI", "e1g1 e7e5 f1e1 e5e1 d1e1", reflected)
        assert row["trace"][-1]["balance"] == 80 and board.legal_moves.count() == 4
        row["scope"] = "One legal queen-for-knight-and-rook exchange; not all-response strategy or position evaluation"
        rows.append(row)
    return {"scope": "Independent python-chess legal replay and exact material ledger only. Neither root is adjudicated as a proved tactic or positional negative.",
            "pythonChessVersion": chess.__version__, "contracts": len(rows), "rows": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = run()
    with open(args.output, "x", encoding="utf8") as stream:
        json.dump(result, stream, indent=2)
    print(json.dumps({"contracts": result["contracts"], "output": args.output}))
