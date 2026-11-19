from pathlib import Path
import hashlib
import subprocess
import json
import sys
lab,work=map(Path,sys.argv[1:])
baseline = json.loads((work/"baseline-source.json").read_bytes())
legacy=lab/"legacy"
legacy.mkdir(parents=True, exist_ok=False)
path=Path("src/utils/tacticalMotifs/causalTactics.ts")
stored=legacy/path
stored.parent.mkdir(parents=True)
stored.write_bytes(subprocess.check_output(["git","show",f"{baseline['head']}:{path.as_posix()}"]))
subprocess.run(["git","apply","--check",str(work/"baseline-causal.patch")],cwd=legacy,check=True)
subprocess.run(["git","apply",str(work/"baseline-causal.patch")],cwd=legacy,check=True)
digest=lambda data:hashlib.sha256(data).hexdigest()
for source,wanted in baseline["hashes"].items():
    data=stored.read_bytes() if source==path.as_posix() else subprocess.check_output(["git","show",f"{baseline['head']}:{source}"])
    variants={"source":data,"lf":data.replace(b"\r\n",b"\n"),"checkout":Path(source).read_bytes()}
    variants["crlf"]=variants["lf"].replace(b"\n",b"\r\n")
    result=next((style for style,version in variants.items() if digest(version)==wanted),None)
    if not result:
        raise RuntimeError("Baseline preimage hash mismatch: "+source)
    print(result,Path(source).name)
