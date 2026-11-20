"""Freeze quiet preparation and near-miss cases outside the cached games."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
from pathlib import Path

import chess
import chess.pgn


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def board_key(board):
    return min(board.epd(), board.mirror().epd())


def mates_one(board):
    for move in list(board.legal_moves):
        if not board.gives_check(move):
            continue
        board.push(move)
        won = board.is_checkmate()
        board.pop()
        if won:
            yield move


def proof(board, move):
    if not board.is_legal(move) or not board.gives_check(move):
        return None
    board.push(move)
    try:
        if board.is_checkmate() or board.halfmove_clock >= 99 or board.is_repetition(3):
            return None
        replies = {}
        for reply in list(board.legal_moves):
            board.push(reply)
            after = next(mates_one(board), None)
            board.pop()
            if after is None:
                return None
            replies[reply.uci()] = after.uci()
        return replies or None
    finally:
        board.pop()


def checks(board):
    return {move: witness for move in list(board.legal_moves) if (witness := proof(board, move))}


def cooperative(board):
    # A tempting legal line can end in mate even when the first check
    # has an adequate evasion. The exhaustive comparison above decides.
    for move in list(board.legal_moves):
        if not board.gives_check(move):
            continue
        board.push(move)
        example = None
        for reply in list(board.legal_moves):
            board.push(reply)
            mate = next(mates_one(board), None)
            board.pop()
            if mate:
                example = [move.uci(), reply.uci(), mate.uci()]
                break
        board.pop()
        if example:
            return example
    return None


def offer(board, move, actual, include_controls):
    if (board.is_check() or board.is_capture(move) or board.gives_check(move) or move.promotion
        or board.halfmove_clock >= 95):
        return None
    attacker = board.turn
    child = board.copy()
    child.push(move)
    turn = child.copy(stack=False)
    turn.turn = attacker
    turn.ep_square = None
    if turn.is_check() or next(mates_one(board), None):
        return None
    if next(mates_one(turn), None):
        return dict(kind="immediate", threats=[]) if include_controls else None
    candidates = checks(turn)
    if not candidates:
        example = cooperative(turn) if include_controls else None
        return dict(kind="cooperative", hint=example, threats=[]) if example else None
    shared = {check for check in candidates if proof(board, check)}
    available = [check for check in candidates if check not in shared]
    if not available:
        return dict(kind="existing", threats=[move.uci() for move in candidates])
    ignored, defences = {}, []
    ordered = [actual, *[reply for reply in child.legal_moves if reply != actual]]
    for reply in ordered:
        if reply is None or not child.is_legal(reply):
            continue
        child.push(reply)
        if child.can_claim_draw() or child.is_game_over():
            child.pop()
            continue
        legal = [(check, proof(child, check)) for check in available]
        match = next(((check, evidence) for check, evidence in legal if evidence), None)
        if match:
            check, proof_map = match
            ignored[reply.uci()] = [check.uci(), proof_map]
        elif not checks(child) and not next(mates_one(child), None):
            defences.append(reply.uci())
        child.pop()
        if ignored and len(defences) >= 2:
            break
    if ignored and defences:
        return dict(kind="new-mate-two", ignores=ignored, defences=defences,
                    threats=[move.uci() for move in available])
    return dict(kind="no-different-defence" if ignored else "refuted-idea",
                threats=[move.uci() for move in available])


def identity(start, moves):
    return hashlib.sha256("\0".join((start, *(move.uci() for move in moves[:24]))).encode()).hexdigest()


def find_file(task):
    path, avoid_games, avoid_boards, include_controls = task
    cases, pop = [], Counter()
    with open(path, encoding="utf-8-sig", errors="replace") as stream:
        while (game := chess.pgn.read_game(stream, Visitor=Broadcast)) is not None:
            site=game.headers.get("Site","")
            control=game.headers.get("TimeControl","").split("+")[0].split("/")[-1]
            if (any(tag in site.lower().split("/") for tag in ("blitz","rapid","bullet")) or
                any(f"-{tag}-" in site.lower() for tag in ("rapid","blitz","bullet","armageddon","freestyle")) or
                control.isdecimal() and int(control)<3600):
                continue
            board=game.board()
            start=board.fen()
            if game.errors or game.headers.get("Result") not in ("1-0","0-1","1/2-1/2") or not board.is_valid() or board.chess960:
                continue
            nodes=list(game.mainline())
            moves=[node.move for node in nodes]
            if len(moves)<38:
                continue
            key=identity(start, moves)
            if key in avoid_games:
                continue
            candidates=[]
            for ply, node in enumerate(nodes):
                move=node.move
                if 40<=ply<min(165,len(nodes)-3) and not board.is_game_over():
                    before=node.parent.eval()
                    after=node.eval()
                    cp = before.pov(board.turn).score() if before is not None else 100
                    next_cp = after.pov(board.turn).score() if after is not None else 100
                    # Selection by quiet move and a viable live engine annotation.
                    # Anticipate threats without selecting forced mates already in the annotation.
                    if cp is not None and next_cp is not None and -150 <= cp <= 950 and next_cp >= -150:
                        attacker = len(board.pieces(chess.QUEEN, board.turn)) + len(board.pieces(chess.ROOK, board.turn))
                        if attacker and board_key(board) not in avoid_boards:
                            result=offer(board,move,moves[ply+1],include_controls)
                            if result:
                                item=dict(id=f"quiet-two-{key[:16]}-{ply}", fen=board.fen(),
                                          history=dict(fen=start,moves=[m.uci() for m in moves[:ply]]),
                                          game=key, site=game.headers.get("Site"), event=Path(path).stem,
                                          gameMoveUci=move.uci(), reference=result)
                                candidates.append(item)
                board.push(move)
            for result in candidates:
                pop[result["reference"]["kind"]]+=1
            ranked=sorted(candidates,key=lambda item:(item["reference"]["kind"]!="new-mate-two",
                  hashlib.sha256(item["id"].encode()).hexdigest()))
            if ranked:
                cases.append(ranked[0])
    print(Path(path).name, len(cases), dict(pop), flush=True)
    return cases, dict(pop)


def read(path):
    return json.loads(Path(path).read_bytes())


def freeze(args):
    avoid_games, avoid_boards=set(),set()
    for previous in args.exclude:
        for row in read(previous):
            board=chess.Board(row["fen"])
            avoid_boards.add(board_key(board))
            history=row.get("history")
            if history and len(history["moves"])>=24:
                avoid_games.add(identity(history["fen"],[chess.Move.from_uci(move) for move in history["moves"][:24]]))
    picks=[]
    sources={}
    jobs=[(path, avoid_games, avoid_boards,args.controls) for path in args.sources]
    with ProcessPoolExecutor(max_workers=6) as pool:
        for path,(rows,pop) in zip(args.sources,pool.map(find_file,jobs),strict=True):
            picks.extend(rows)
            sources[str(path)]=dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),population=pop)
    taken=[]
    counts=Counter()
    by_event=Counter()
    for row in sorted(picks,key=lambda item:hashlib.sha256(item["id"].encode()).hexdigest()):
        kind=row["reference"]["kind"]
        if (row["game"] in avoid_games or board_key(chess.Board(row["fen"])) in avoid_boards
            or counts[kind]>=args.quota or by_event[row["event"],kind]>=args.per_event):
            continue
        avoid_games.add(row["game"])
        avoid_boards.add(board_key(chess.Board(row["fen"])))
        taken.append(row)
        counts[kind]+=1
        by_event[row["event"],kind]+=1
    with args.output.open("x",encoding="utf-8") as stream:
        json.dump(taken,stream,separators=(",",":"))
    with args.manifest.open("x",encoding="utf-8") as stream:
        json.dump(dict(sources=sources, cases=counts),stream,indent=2)
    print("Frozen",dict(counts))


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    parser.add_argument("manifest",type=Path)
    parser.add_argument("sources",type=Path,nargs="+")
    parser.add_argument("--controls",action="store_true")
    parser.add_argument("--per-event",type=int,default=1000)
    parser.add_argument("--quota",type=int,default=14)
    parser.add_argument("--exclude",type=Path,nargs="+",default=[])
    freeze(parser.parse_args())
