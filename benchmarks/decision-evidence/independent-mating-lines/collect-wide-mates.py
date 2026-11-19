import json,sys,importlib.util
from pathlib import Path
import chess,chess.engine
w,exe=map(Path,sys.argv[1:])
src=Path('benchmarks/decision-evidence/opened-rook-file/prepare.py')
spec=importlib.util.spec_from_file_location("matched_search",src.resolve())
study=importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)
rows=json.loads((w/'mate-holdout-input.json').read_bytes())
results=[]
for x in rows:
 if x['candidates'][0]['mate'] is None:continue
 board=chess.Board(x['fen'])
 with chess.engine.SimpleEngine.popen_uci(exe) as u:
  u.configure({'Threads':1,'Hash':64})
  roots,root_cost=study.search.search_replies(u,board,min(3,board.legal_moves.count()),20_000_000)
 best=roots[0]
 child=board.copy(stack=False)
 child.push_uci(best['pvUci'][0])
 with chess.engine.SimpleEngine.popen_uci(exe) as u:
  u.configure({'Threads':1,'Hash':64})
  lines,cost=study.search.search_replies(u,child,min(3,child.legal_moves.count()),20_000_000)
 result=dict(x,candidates=roots,replyProbes=[{'moveUci':best['pvUci'][0],'lines':lines,'cost':cost}],
    referenceReplies=[],rootCost=root_cost)
 results.append(result)
 print(x['id'], roots[0]['mate'], lines[0]['mate'],root_cost['nodes'],cost['nodes'],flush=True)
study.write_new(w/'mate-holdout-wide.json',results)
