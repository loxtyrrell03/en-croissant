"""Freeze ordinary and annotated-loss positions before either classifier runs."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import chess
import chess.pgn


def read(path):
    return json.loads(path.read_bytes())


def identity(fen, moves):
    return sha256("|".join((fen,*moves[:24])).encode()).hexdigest()


def board_key(board):
    return min(board.epd(),board.mirror().epd())


class Broadcast(chess.pgn.GameBuilder):
    def handle_error(self, error):
        self.game.errors.append(error)


def candidates(path, blocked_games, blocked_boards, owner):
    with path.open(encoding="utf-8-sig",errors="replace") as handle:
        while (game:=chess.pgn.read_game(handle,Visitor=Broadcast)) is not None:
            if game.errors or game.headers.get("Result") not in ("1-0","0-1","1/2-1/2"):continue
            root=game.board()
            if root.chess960 or not root.is_valid():continue
            fen=root.fen()
            sequence=[node.move.uci() for node in game.mainline()]
            fingerprint=identity(fen,sequence)
            if fingerprint in blocked_games:continue
            sample=[]
            for i,node in enumerate(game.mainline()):
                if i<32 or i>min(len(sequence)-12,110):continue
                board=node.parent.board()
                if board.halfmove_clock>35 or board.is_check() or len(board.piece_map())<9 or board_key(board) in blocked_boards:continue
                prev,actual=node.parent.eval(),node.eval()
                drop=None if prev is None or actual is None else prev.pov(board.turn).score(mate_score=10000)-actual.pov(board.turn).score(mate_score=10000)
                if owner and (i % 2 == 0) != game.headers.get("White","").lower().startswith("lachlan"):
                    continue
                item=sha256(f"mixed-reference-2026-11:{fingerprint}:{i}".encode()).hexdigest()[:16]
                sample.append(dict(
                    id=("private-" if owner else "public-")+item, fen=board.fen(), playedMoveUci=node.move.uci(),
                    history=dict(fen=fen,moves=sequence[:i]), game=fingerprint,
                    event="owner-classical" if owner else path.stem,
                    site=None if owner else game.headers.get("Site"),
                    category="annotated loss" if drop is not None and 95 <= drop <= 450 else "ordinary",
                ))
            if not sample:continue
            yield sample


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    parser.add_argument("sources",type=Path,nargs="+")
    parser.add_argument("--prior",type=Path,nargs="+",required=True)
    parser.add_argument("--owner",type=Path,nargs="*",default=[])
    args=parser.parse_args()
    prior=[row for p in args.prior for row in read(p)]
    games={identity(h["fen"],h["moves"]) for r in prior if (h:=r.get("history")) and len(h["moves"])>=24}
    finite_boards={board_key(chess.Board(r["fen"])) for r in prior}
    chosen,manifest=[],{}
    for path in [*args.sources,*args.owner]:
        owner=path in args.owner
        choices=[row for group in candidates(path,games,finite_boards,owner) for row in group]
        counters=Counter()
        for target in ("annotated loss","ordinary"):
            for case in sorted((r for r in choices if r["category"]==target),key=lambda row:row["id"]):
                if owner and sum(counters.values())>=1 or not owner and counters[target]>=3:break
                key=board_key(chess.Board(case["fen"]))
                if case["game"] in games or key in finite_boards:continue
                games.add(case["game"])
                finite_boards.add(key)
                counters[target]+=1
                chosen.append(case)
        name="owner" if owner else path.name
        manifest.setdefault(name,[]).append(dict(sha256=sha256(path.read_bytes()).hexdigest(),sample=dict(counters)))
    with args.output.open("x",encoding="utf-8") as output:
        json.dump(chosen,output,separators=(",",":"))
    with args.output.with_name("prospective-manifest.json").open("x",encoding="utf-8") as output:
        json.dump(manifest,output,indent=2)
    print(len(chosen),dict(Counter(x["category"] for x in chosen)),flush=True)


if __name__=="__main__":
    main()
