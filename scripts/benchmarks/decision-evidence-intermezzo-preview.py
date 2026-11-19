"""Nominate check-before-recapture decisions using shallow classical-game previews."""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import importlib.util
import json
from pathlib import Path

import chess
import chess.engine

directory=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('tournament',directory/'decision-evidence-tournament.py')
tournament=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tournament)


def check_before_recapture(board, line):
    if len(line) < 5:
        return False
    first, reply, check, defence, take = line[:5]
    if first.to_square != reply.to_square or take.to_square != reply.to_square:
        return False
    board.push(first)
    if not board.is_capture(reply):
        return False
    board.push(reply)
    if not board.gives_check(check) or not board.is_legal(take) or check.to_square == take.to_square:
        return False
    board.push(check)
    board.push(defence)
    return board.is_capture(take)


def inspect(task):
    executable, rows, nodes, multipv=task
    pool=[]
    with chess.engine.SimpleEngine.popen_uci(executable) as engine:
        engine.configure({'Threads':1,'Hash':32 if multipv == 1 else 64})
        for row in rows:
            board=chess.Board(row['fen'])
            board.push_uci(row['playedMoveUci'])
            if board.is_game_over():
                continue
            engine.configure({'Clear Hash':None})
            info=engine.analyse(board,chess.engine.Limit(nodes=nodes),multipv=multipv)[0]
            line=info.get('pv',[])
            if check_before_recapture(board,line):
                pool.append(dict(row,previewNodes=info.get('nodes'),previewUci=[m.uci() for m in line[:5]]))
    return pool


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out',type=Path)
    parser.add_argument('engine',type=Path)
    parser.add_argument('--event',action='append',required=True,nargs=2)
    parser.add_argument('--exclude',type=Path,action='append',default=[])
    parser.add_argument('--limit-per-event',type=int,default=150)
    parser.add_argument('--nodes',type=int,choices=[60000,1000000],default=60000)
    parser.add_argument('--multipv',type=int,choices=[1,3],default=1)
    args=parser.parse_args()
    if args.out.resolve().is_relative_to(directory.parents[1]):
        raise ValueError('Keep previews outside the checkout')
    boards,games=set(),set()
    for f in args.exclude:
        for row in json.loads(f.read_bytes())['cases']:
            boards.add(tournament.board_key(row['fen']))
            if row.get('sourceGroup'):
                games.add(row['sourceGroup'])
    rows=[]
    metadata={}
    for event, filename in args.event:
        path=Path(filename)
        raw=tournament.read_games(path,boards,broadcast_loss=True)
        eligible=[]
        for group, positions in raw.items():
            if group in games:
                continue
            for row in positions:
                loss=row.get('broadcastLossCp')
                if loss is None or not (loss >= 90 or abs(loss) <= 25):
                    continue
                key=f'recapture-preview-{event}-{group[:16]}-{row["ply"]}'
                eligible.append(dict(row,id=key,sourceGroup=group,event=event,split='validation',
                                     stratum='preview-loss' if loss>=90 else 'preview-control',
                                     category='public-classical-broadcast'))
        ordered=sorted(eligible,key=lambda row:tournament.order(row['id']))
        subset=[]
        seen=set()
        for kind in ('preview-loss','preview-control'):
            count=0
            for row in ordered:
                if row['stratum']!=kind or row['sourceGroup'] in seen:
                    continue
                subset.append(row)
                seen.add(row['sourceGroup'])
                count+=1
                if count>=args.limit_per_event:
                    break
        if subset:
            rows.extend(subset)
        metadata[event]={'sha256':tournament.digest(path.read_bytes()),'previewed':dict(Counter(r['stratum'] for r in subset))}
    tasks=[(str(args.engine),rows[i:i+32],args.nodes,args.multipv) for i in range(0,len(rows),32)]
    with ProcessPoolExecutor(max_workers=4) as pool:
        nominated=[row for batch in pool.map(inspect,tasks) for row in batch]
    print(metadata, len(rows),Counter(row['stratum'] for row in nominated))
    for row in nominated:
        row.pop('pinChallenge',None)
    with args.out.open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(dict(protocol=1,events=metadata,cases=nominated,previewNodes=args.nodes,previewMultiPv=args.multipv),stream,indent=2)
        stream.write('\n')


if __name__=='__main__':
    main()
