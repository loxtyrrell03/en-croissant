from pathlib import Path
import json, sys,chess
r,w,l=map(Path,sys.argv[1:])
seen=set()
paths=[
 w/"reply-coverage-audit/full-pair-input.json",
 r/"benchmarks/decision-evidence/outposts-after-exchanges/reserve.json",
 w/"passer-interception-transfer/final-input.json",
]
paths+=list((r/"benchmarks/decision-evidence").glob("*/reserve.json"))
paths+=list((r/"benchmarks/decision-evidence").glob("*/app-transfer/*.json"))
heldout_names=set(["outposts-after-exchanges/reserve.json","passed-pawn-interception/app-transfer/late-reserve.json"])
sets={"archive":[],"reserve":[]}
for path in dict.fromkeys(paths):
 if not path.exists():continue
 try: data=json.loads(path.read_bytes())
 except (OSError,ValueError): continue
 if not isinstance(data,list):continue
 archive=path.is_relative_to(w)
 mode="reserve" if not archive else "archive"
 for row in data:
  if not isinstance(row,dict) or not (row.get("fen") and row.get("candidates") and row.get("id")):
   continue
  try:b=chess.Board(row["fen"])
  except ValueError:continue
  key=min(b.epd(),b.mirror().epd())
  if key in seen:continue
  if mode=="reserve" and not str(row.get("site","")).startswith("https://lichess.org/broadcast/"):
   # Local publication replay sometimes has only provenance from its parent manifest.
   if not any(("/"+name) in path.as_posix() for name in heldout_names):continue
  selected={k:row[k] for k in ("id","fen","candidates","playedMoveUci","comparisonCandidates","replyProbes","history","site","event","phase","label") if k in row}
  selected["sourceFile"]=path.relative_to(w if archive else r).as_posix()
  seen.add(key)
  sets[mode].append(selected)
for mode,rows in sets.items():
 (l/(mode+"-input.json")).write_text(json.dumps(rows,separators=(",",":")),encoding="utf-8")
 print(mode,len(rows))
