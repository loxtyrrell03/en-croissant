"""Stream public puzzle records without writing a local copy of the database."""
from collections import Counter
from csv import DictReader
from hashlib import sha256
from io import TextIOWrapper
import json
from pathlib import Path
import sys
from urllib.request import Request,urlopen

import chess
import zstandard

destination=Path(sys.argv[1])
limit=4_500_000
source="https://database.lichess.org/lichess_db_puzzle.csv.zst"
request=Request(source,headers={"User-Agent":"EnCroissant-local-research"})
puzzles={}
roots=set()
with urlopen(request,timeout=25) as response:
    metadata={h:response.headers.get(h) for h in ("ETag","Last-Modified","Content-Length")}
    with zstandard.ZstdDecompressor().stream_reader(response) as stream:
        for i, row in enumerate(DictReader(TextIOWrapper(stream,encoding="utf-8")),1):
            if i>limit:
                break
            if i%500_000==0:
                print(i,len(puzzles),flush=True)
            seq=row["Moves"].split()
            if len(seq)<6 or len(seq[1])!=5 or seq[2][2:4]!=seq[1][2:4] or seq[5][2:4]!=seq[1][2:4]:
                continue
            game=row["GameUrl"].split("#")[0].split("/")[-1][:8]
            if game in puzzles:
                continue
            root=chess.Board(row["FEN"])
            first=root.parse_uci(seq[0]);root.push(first)
            fen=root.fen()
            key=min(root.epd(),root.mirror().epd())
            if key in roots:
                continue
            board=root.copy()
            moves=[chess.Move.from_uci(uci) for uci in seq[1:6]]
            cls="geometry-control"
            if all(board.is_legal(m) for m in moves[:1]):
                promotion,take,checking,answer,retake=moves
                board.push(promotion)
                if not board.is_legal(take) or not board.is_capture(take):continue
                board.push(take)
                earlier=board.is_legal(retake)
                board.push(checking)
                if board.is_check() and earlier and board.piece_type_at(answer.from_square)==chess.KING:
                    cls="checking-recapture"
                board.push(answer)
                if not board.is_legal(retake) or not board.is_capture(retake):continue
            puzzles[game]=dict(id=row["PuzzleId"],game=game,site="https://lichess.org/training/"+row["PuzzleId"],
                  fen=fen,sourcePath=seq[1:],stratum=cls,rating=int(row["Rating"]))
            roots.add(key)
rows=sorted(puzzles.values(),key=lambda r:sha256(("promotion-tempo-2c52c962"+r["id"]).encode()).hexdigest())
destination.write_text(json.dumps(dict(source=source,headers=metadata,scanned=min(i,limit),
    strata=dict(Counter(r["stratum"] for r in rows)),rows=rows),indent=2),encoding="utf-8")
print(min(i,limit),Counter(r["stratum"] for r in rows),flush=True)
