"""Find fresh classical exchanges that can advance a pawn to the seventh."""

import argparse
import concurrent.futures
import hashlib
import importlib
import json
from pathlib import Path

import chess
import chess.engine
import chess.pgn

payoff = importlib.import_module("decision-evidence-fork-payoff")
tournament = importlib.import_module("decision-evidence-tournament")
PREVIEW_NODES = 18_000


def relative_rank(square, side):
    return 1 + chess.square_rank(square) if side else 8 - chess.square_rank(square)


def exchange_squares(board):
    side = board.turn
    files = [square for square in board.pieces(chess.PAWN, side) if relative_rank(square, side) == 6]
    return {target for square in files for target in board.attacks(square)}


def select_games(path, name, blocked_boards, blocked_games, with_controls, leading):
    candidates = []
    with path.open(encoding="utf-8-sig") as file:
        while game := chess.pgn.read_game(file):
            board = game.board()
            if game.errors or type(board) is not chess.Board or not board.is_valid():
                continue
            moves = list(game.mainline_moves())
            if len(moves) < 25 or game.headers.get("Result") not in {"1-0", "0-1", "1/2-1/2"}:
                continue
            signature = tournament.board_key(board.fen()) + " " + " ".join(move.uci() for move in moves)
            game_key = hashlib.sha256(signature.encode()).hexdigest()
            if game_key in blocked_games:
                continue
            game_rows = []
            for move in moves:
                ply, side = board.ply(), board.turn
                rank = relative_rank(move.to_square, side)
                possible = (rank == 7 or with_controls and rank == 6) and (
                    board.piece_type_at(move.from_square) not in (chess.PAWN, chess.KING)
                    and board.attackers(side, move.to_square) & board.pieces(chess.PAWN, side)
                )
                if leading and ply >= 24:
                    targets = exchange_squares(board)
                    possible = targets and any(
                        candidate.to_square in targets
                        and board.piece_type_at(candidate.from_square) not in (chess.PAWN, chess.KING)
                        for candidate in board.legal_moves
                    )
                if ply >= 24 and possible:
                    pos_key = payoff.corpus.board_identity(board)
                    if pos_key not in blocked_boards:
                        game_rows.append(dict(id=f"passer-{name}-{game_key[:14]}-{ply}", game=game_key, event=name,
                                              move=None if leading else move.uci(), fen=board.fen(), boardKey=pos_key, ply=ply))
                board.push(move)
            candidates.extend(sorted(game_rows, key=lambda row: payoff.key(row["id"]))[:3] if leading else game_rows)
    return candidates


def screen(batch):
    rows, executable = batch
    selected = []
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({"Hash": 32, "Threads": 1})
        for row in rows:
            board = chess.Board(row["fen"])
            side = board.turn
            move = row["move"]
            if move is None:
                candidates = payoff.search(engine, board, PREVIEW_NODES)
                if not candidates:
                    continue
                move = candidates[0]["pv"][0]
                candidate = board.parse_uci(move)
                if (candidate.to_square not in exchange_squares(board)
                    or board.piece_type_at(candidate.from_square) in (chess.PAWN, chess.KING)):
                    continue
            root = board.parse_uci(move)
            board.push(root)
            if not any(move.to_square == root.to_square and board.is_capture(move) for move in board.legal_moves):
                continue
            replies = payoff.search(engine, board, PREVIEW_NODES)
            if not replies or len(replies[0]["pv"]) < 2:
                continue
            defence = board.parse_uci(replies[0]["pv"][0])
            if defence.to_square != root.to_square or not board.is_capture(defence):
                continue
            board.push(defence)
            recapture = board.parse_uci(replies[0]["pv"][1])
            if recapture.to_square != root.to_square or board.piece_type_at(recapture.from_square) != chess.PAWN:
                continue
            board.push(recapture)
            rank = relative_rank(root.to_square, side)
            promotion = root.to_square + (8 if side else -8)
            block = False
            if rank == 7:
                for uci in replies[0]["pv"][2:6]:
                    step = board.parse_uci(uci)
                    if step.from_square == root.to_square or step.to_square == root.to_square:
                        break
                    block |= board.turn != side and step.to_square == promotion
                    board.push(step)
            selected.append(dict(row, move=move, preview=dict(reply=defence.uci(), recapture=recapture.uci(),
                                                     pawnRank=rank, blockade=block)))
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--event", nargs=2, action="append", metavar=("NAME", "PGN"), required=True)
    parser.add_argument("--exclude", type=Path, nargs="+", required=True)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=6)
    parser.add_argument("--per-rank", type=int, default=14)
    parser.add_argument("--sixth-rank-controls", action="store_true")
    parser.add_argument("--prioritize-blockades", action="store_true")
    parser.add_argument("--leading-moves", action="store_true",
                        help="Preview leading moves at up to three boards per game, separately from played moves")
    args = parser.parse_args()
    games, boards, exclusions = set(), set(), []
    for path in args.exclude:
        exclusions.append(dict(name=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        for row in payoff.read(path)["cases"]:
            boards.add(payoff.corpus.board_identity(chess.Board(row["fen"])))
            source = row.get("game") or row.get("sourceGroup")
            if source:
                games.add(source)
    sources = {}
    candidates = []
    for name, file in args.event:
        path = Path(file)
        pool = select_games(path, name, boards, games, args.sixth_rank_controls, args.leading_moves)
        candidates.extend(pool)
        sources[name] = dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), candidates=len(pool))
    windows = [(candidates[i:i + 55], str(args.engine.resolve())) for i in range(0, len(candidates), 55)]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        preview = [row for group in pool.map(screen, windows) for row in group]
    cases = []
    # Sixth-rank exchanges deliberately survive as controls. No scores or
    # classifier output are used to choose between games within a stratum.
    for rank in (7, 6) if args.sixth_rank_controls else (7,):
        eligible = (row for row in preview if row["preview"]["pawnRank"] == rank)
        count = 0
        for row in sorted(eligible, key=lambda item: (
            args.prioritize_blockades and not item["preview"]["blockade"],
            payoff.key(item["id"]),
        )):
            if count >= args.per_rank:
                break
            if row["game"] in games or row["boardKey"] in boards:
                continue
            games.add(row["game"])
            boards.add(row["boardKey"])
            cases.append(row)
            count += 1
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(dict(previewNodes=PREVIEW_NODES, screened=len(candidates), sources=sources,
                       exclusions=exclusions, leadingMoves=args.leading_moves,
                       matchedExchanges=len(preview), cases=cases), file, indent=2)
    print(json.dumps(dict(screened=len(candidates), matched=len(preview), selected=len(cases),
                          seventhRank=sum(row["preview"]["pawnRank"] == 7 for row in cases))))


if __name__ == "__main__":
    main()
