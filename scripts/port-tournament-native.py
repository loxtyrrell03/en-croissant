"""Isolate Novelty's tournament reader and OTB-only download manager."""
from pathlib import Path
import shutil,re,json,sys
T=Path(__file__).resolve().parents[1];S=T.parent/'outpost-chess';D=T/'src-tauri/tournament-core'
assert not (D/'src/lib.rs').exists(),'Initial port only: maintained native adapters must never be overwritten'
(D/'src').mkdir(parents=True,exist_ok=True);(D/'config').mkdir(exist_ok=True)
files=['tournament.rs','tournament/discovery.rs','tournament/media.rs','tournament/schedule.rs','otb_packs.rs','data_pack.rs','data_pack/install.rs','data_pack/cache.rs','data_pack/jobs.rs','data_pack/removal.rs','data_pack/otb_library.rs']
for name in files:
    dst=D/'src'/name;dst.parent.mkdir(parents=True,exist_ok=True);text=(S/'src-tauri/src'/name).read_text(encoding='utf-8')
    if name=='tournament/discovery.rs':
        text=text.replace('crate::lichess_oauth::open_url_with_system(&url)','Err("Open the validated link using the host browser adapter.".into())')
    if name=='data_pack/install.rs':text=text.replace('crate::local_lichess::transfer::download_with_size','crate::transfer::download_with_size')
    if name=='data_pack/jobs.rs':
        text=text.replace('entries.extend(crate::otb_packs::extra_catalog()?);','entries.retain(|entry| entry.kind == Kind::Otb);\n    entries.extend(crate::otb_packs::extra_catalog()?);')
        # Multi-selection is an opening/evaluation product API, not part of OTB.
        text=text[:text.index('/// Existing verified stores are read-only candidates;')]
    if name=='data_pack.rs':text=text.replace('#[cfg(test)]\nmod tests;','')
    text=text.replace('../../../config/','../../config/') if name.startswith('data_pack/') else text.replace('../../config/','../config/')
    dst.write_text(text,encoding='utf-8')
for name in ['otb-data-license.txt','broadcast-data-license.txt']:
    shutil.copy2(S/'config'/name,D/'config'/name)
catalog=json.loads((S/'config/data-packs.json').read_text(encoding='utf-8'))
(D/'config/data-packs.json').write_text(json.dumps([entry for entry in catalog if entry['kind']=='otb'],indent=2)+'\n')
for name in ['transfer.rs','transfer_tests.rs']:
    text=(S/'src-tauri/src/local_lichess'/name).read_text(encoding='utf-8').replace('pub(super) fn client','pub(crate) fn client')
    (D/'src'/name).write_text(text,encoding='utf-8')
print('Copied tournament native reader and isolated OTB transport; no Novelty write.')
