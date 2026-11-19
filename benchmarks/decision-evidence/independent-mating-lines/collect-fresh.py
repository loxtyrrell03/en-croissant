from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import importlib.util, json, hashlib, sys
w, engine, compatible = map(Path,sys.argv[1:])
spec=importlib.util.spec_from_file_location("engine_replay",Path("benchmarks/decision-evidence/opened-rook-file/prepare.py"))
study=importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)
earlier=[x for f in (w/'public-input.json',compatible) for x in json.loads(f.read_bytes())]
excluded={study.sampling.board_key(x['fen']) for x in earlier}
seen_games={x.get("sourceGroup") for x in earlier}
seen=set(excluded)
rows=[]
manifest={}
for event in ('voivodina','witney','kazakhstan','lagos'):
 path=w/(event+'.pgn')
 games=study.sampling.read_games(path,excluded)
 selected=study.sampling.select_event(event,games,10,0,seen,seen_games)
 manifest[event]={'cases':len(selected),'pgnSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 rows.extend(selected)
study.write_new(w/'fresh-sample.json',{'events':manifest,'cases':rows})
print(manifest,flush=True)
results=[]
with ThreadPoolExecutor(5) as pool:
 for value in pool.map(study.examine,((row,engine) for row in rows)):
  results.append(value)
  if len(results)%8==0:print('Analysed',len(results),flush=True)
study.write_new(w/'fresh-engine.json',results)
