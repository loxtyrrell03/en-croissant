from pathlib import Path
import json,re,shutil
T=Path(__file__).resolve().parents[1];S=T.parent/'outpost-chess';B=T/'tmp/tournament-port/baseline'
if B.exists():raise SystemExit('Setup already performed; keep baseline intact')
B.mkdir(parents=True)
paths=['AGENTS.md','package.json','pnpm-lock.yaml','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/src/main.rs','src-tauri/src/lib.rs','src-tauri/src/otb_import.rs','src-tauri/src/otb_import/index.rs','src-tauri/src/bin/collect_otb_games.rs','scripts/home-server.mjs','scripts/publish-home-site.ps1','scripts/otb-import-service.mjs','src/components/tabs/NewTabHome.tsx','src/components/panels/prep/OtbGameImportPanel.tsx','src/web/WebApp.tsx','src/web/PhoneOtbImportPanel.tsx']
for name in paths:
    src=T/name
    if src.exists():(B/name).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,B/name)
p=T/'package.json';text=p.read_text();text=text.replace('"dependencies": {','"dependencies": {\n    "@echecs/swiss": "5.0.0",\n    "@echecs/tournament": "3.3.0",',1);p.write_text(text)
lock=T/'pnpm-lock.yaml';text=lock.read_text();source=(S/'pnpm-lock.yaml').read_text()
text=text.replace('    dependencies:\n','    dependencies:\n      \'@echecs/swiss\':\n        specifier: 5.0.0\n        version: 5.0.0(@echecs/tournament@3.3.0)\n      \'@echecs/tournament\':\n        specifier: 3.3.0\n        version: 3.3.0\n',1)
for section in ['packages','snapshots']:
    sectionText=source.split(section+':\n',1)[1].split('\n\n'+('snapshots' if section=='packages' else '__end__')+':')[0]
    blocks=re.findall(r"  '@echecs/[^\n]+\n(?:(?:    [^\n]*|)\n)*",sectionText)
    assert len(blocks)==2,(section,blocks)
    text=text.replace(section+':\n',section+':\n\n'+''.join(blocks),1)
lock.write_text(text)
for name,version in [('swiss','5.0.0'),('tournament','3.3.0')]:
    dest=T/'node_modules/@echecs'/name
    assert not dest.exists(),dest
    candidates=list((S/'node_modules/.pnpm').glob('@echecs+'+name+'@'+version+'*/node_modules/@echecs/'+name))
    assert len(candidates)==1,candidates
    shutil.copytree(candidates[0],dest)
for name in ['DownloadRemovalDialog.tsx','DownloadRemovalDialog.module.css']:
    text=(S/'src/features/settings'/name).read_text().replace('~/platform/bridge','@/features/tournaments/platform')
    (T/'src/features/tournaments/downloads'/name).write_text(text)
with (T/'src/features/tournaments/types.ts').open('a') as f:
    f.write('\nexport interface DownloadRemovalReview { token: string; id: string; bytes: number; paths: string[]; shared: boolean; }\n')
print('Saved owned-file baseline and pinned the two existing Novelty pairing packages.')
