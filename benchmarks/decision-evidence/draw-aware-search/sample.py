"""Find game-disjoint examples where a search can reach a genuine draw boundary."""
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import sys

import chess
import chess.engine
import chess.pgn


def read(path):
    return json.loads(Path(path).read_bytes())


def pawn_or_capture(board, move):
    return board.is_capture(move) or board.piece_type_at(move.from_square) == chess.PAWN


def key(board):
    return min(board.epd(), board.mirror().epd())


def game_id(root, moves):
    return sha256("|".join((root,*moves[:24])).encode()).hexdigest()


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def find_game(source, blocked_boards, blocked_games):
    board = source.board()
    if source.errors or not board.is_valid() or len(board.piece_map()) not in range(3,33) or board.chess960:
        return []
    root = board.fen()
    moves = [move.uci() for move in source.mainline_moves()]
    fingerprint = game_id(root, moves)
    if len(moves) < 65 or fingerprint in blocked_games:
        return []
    repetitions = Counter()
    variants = []
    for ply, uci in enumerate(moves):
        repetitions[board.epd()] += 1
        if repetitions[board.epd()] >= 5 or board.halfmove_clock>=150 or board.is_insufficient_material():
            break
        upcoming = moves[ply:ply+7]
        if ply>=45 and len(upcoming)>=2 and ((f:=key(board)) not in blocked_boards):
            move = board.parse_uci(uci)
            if board.halfmove_clock >= 7 and any(value>=2 for value in repetitions.values()):
                selection = "imminent-repeat" if board.can_claim_threefold_repetition() else "historical-repeat"
            elif len(board.piece_map()) <= 8 and pawn_or_capture(board,move) and chess.popcount(board.pawns) <= 3:
                selection = "thin-material"
            else:
                board.push(move)
                if board.halfmove_clock == 0: repetitions.clear()
                continue
            token = sha256(f"draw-transport-v1:{fingerprint}:{ply}".encode()).hexdigest()[:16]
            variants.append(dict(
                id=token,game=fingerprint,fen=board.fen(),history=dict(fen=root,moves=moves[:ply]),
                playedMoveUci=uci, selection=selection, boardKey=f, sourceUrl=source.headers.get("Site",""),
                playedLine=upcoming,
            ))
        board.push_uci(uci)
        if board.halfmove_clock == 0: repetitions.clear()
    return variants


def freeze(path, archive, pgns):
    old=read(archive)
    blocked_boards={key(chess.Board(item["fen"])) for item in old}
    blocked_games={game_id(h["fen"],h["moves"]) for item in old
                   if (h:=item.get("history")) and len(h["moves"])>=24}
    rows, manifest = [], {}
    for file in pgns:
        population=[]
        with file.open(encoding="utf-8-sig",errors="replace") as stream:
            while (game:=chess.pgn.read_game(stream,Visitor=Broadcast)) is not None:
                if game.headers.get("Result") not in ("1-0","0-1","1/2-1/2"): continue
                population.extend(find_game(game,blocked_boards,blocked_games))
        counts = Counter()
        # Alternate genuinely precarious boards and positions before a claim exists.
        for variant in sorted(population,key=lambda item:item["id"]):
            kind=variant["selection"]
            if counts[kind]>=5 or variant["game"] in blocked_games or variant["boardKey"] in blocked_boards:
                continue
            counts[kind]+=1
            blocked_boards.add(variant.pop("boardKey"))
            blocked_games.add(variant["game"])
            rows.append(dict(variant, event=file.stem))
        manifest[file.name]=dict(sha256=sha256(file.read_bytes()).hexdigest(),selected=counts)
    write(path,rows)
    write(path.with_name("manifest.json"),manifest)
    print(len(rows),dict(Counter(row["selection"] for row in rows)),flush=True)


def evaluate(job):
    row, exe, helper, root_nodes, reply_nodes = job
    sys.path.insert(0, helper)
    from gather import initial,searched
    board=initial(row)
    with chess.engine.SimpleEngine.popen_uci(exe) as engine:
        engine.configure({"Threads":1,"Hash":64})
        candidates=[dict(line,fen=board.fen()) for line in searched(engine, board, root_nodes)]
        roots=list(dict.fromkeys((candidates[0]["pvUci"][0], row["playedMoveUci"])))
        paired=[dict(line,fen=board.fen()) for line in searched(engine,board,root_nodes,fixed=roots)] if len(roots)==2 else []
        replies=[]
        for root in roots:
            reached=board.copy()
            reached.push_uci(root)
            if reached.is_game_over(): continue
            choices=[dict(line,fen=reached.fen()) for line in searched(engine,reached,reply_nodes)]
            if choices: replies.append(dict(moveUci=root,lines=choices))
    return dict(row,candidates=candidates,comparisonCandidates=paired or None,replyProbes=replies)


def write(path,value):
    with path.open("x",encoding="utf-8") as stream:
        json.dump(value,stream,separators=(",",":"))


def main():
    mode,output,*argv=sys.argv[1:]
    if mode=="freeze":
        archive,*pgns=map(Path,argv)
        freeze(Path(output),archive,pgns)
    else:
        source,exe,helper,*budgets=argv
        root,reply=map(int,budgets) if budgets else (2_400_000,1_400_000)
        with ProcessPoolExecutor(max_workers=7) as pool:
            rows=[]
            for row in pool.map(evaluate,[(row,exe,helper,root,reply) for row in read(source)]):
                if row["comparisonCandidates"] is None: del row["comparisonCandidates"]
                rows.append(row)
                if len(rows)%20==0: print(len(rows),flush=True)
        write(Path(output),rows)
        print(len(rows),flush=True)

if __name__=="__main__":
    main()
