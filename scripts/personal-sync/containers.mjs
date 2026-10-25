import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openEn,enRows,rowHash,transaction} from './en-database.mjs';

function scan(root,referencePaths,cache){
  const info=fs.lstatSync(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Database root is missing or redirected');
  const result=[];
  const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Database sync does not follow links');
    if(e.isDirectory())visit(file);
    else if(e.isFile()&&/\.db3$/i.test(e.name)&&!e.name.includes('.tmp.')&&!referencePaths.has(path.relative(root,file).replaceAll('\\','/').toLowerCase())){
      const stamp=()=>JSON.stringify([file,file+'-wal',file+'-journal'].map(p=>{try{const s=fs.statSync(p,{bigint:true});return [String(s.size),String(s.mtimeNs),String(s.ctimeNs),String(s.ino)];}catch(error){if(error.code==='ENOENT')return null;throw error;}}));
      const before=stamp(),old=cache?.get(file);
      if(old?.stamp===before&&Date.now()-old.at<600000){result.push({...old.entry});continue;}
      const db=new DatabaseSync(file,{readOnly:true});try{
        const values=new Map(db.prepare('SELECT Name,Value FROM Info').all().map(r=>[r.Name,r.Value]));
        const id=values.get('PersonalSyncId');
        if(!id&&fs.statSync(file).size>512*1024*1024)throw Error('A large unlinked database needs reference classification before sync');
        const entry={file,relative:path.relative(root,file).replaceAll('\\','/'),id:id?Number(id):null,title:values.get('Title')||path.basename(file,'.db3')};
        if(stamp()!==before)throw Error('Database changed while its identity was being read');
        result.push(entry);cache?.set(file,{stamp:before,at:Date.now(),entry});
      }finally{db.close();}
    }
  }};visit(root);if(cache){const present=new Set(result.map(r=>r.file));for(const file of cache.keys())if(!present.has(file))cache.delete(file);}return result;
}
const baseGames=(b,id)=>b.ledger.prepare('SELECT * FROM sync_games WHERE collection_id=? ORDER BY left_id').all(id);
function leftUnchanged(b,m){
  const current=b.source.prepare('SELECT id,pgn FROM game_record WHERE collection_id=? ORDER BY id').all(m.id),base=baseGames(b,m.id);
  return current.length===base.length&&current.every((r,i)=>r.id===base[i].left_id&&r.pgn===base[i].base_pgn);
}
function rightUnchanged(b,m,db){
  const rows=enRows(db),base=baseGames(b,m.id),map=new Map(base.map(r=>[r.right_id,r.right_hash]));
  return rows.length===base.length&&rows.every(r=>rowHash(r)===map.get(r.ID));
}
function absentTwice(b,id,side){
  const key=`missing:${id}:${side}`,old=b.ledger.prepare('SELECT value FROM sync_meta WHERE key=?').get(key);
  if(!old){b.ledger.prepare('INSERT INTO sync_meta VALUES(?,?)').run(key,String(Date.now()));return false;}
  return Date.now()-Number(old.value)>=10_000;
}
function resetMissing(b,id,side){b.ledger.prepare('DELETE FROM sync_meta WHERE key=?').run(`missing:${id}:${side}`);}
function saveRecovery(b,kind,payload){b.ledger.prepare('INSERT INTO recovery VALUES(?,?,?,?)').run(randomUUID(),kind,JSON.stringify(payload),new Date().toISOString());}

// Container changes are separate from game diffs: a missing/moving database
// must never be interpreted as a thousand independent game deletions.
export async function reconcileContainers(b,{collectionPath,canMove=()=>true}={}){
  const report={changed:0,conflicts:[],errors:[]};
  const entries=scan(b.enRoot,new Set((b.referencePaths??[]).map(p=>p.toLowerCase())),b.cacheUnchanged?b.containerCache:null),byId=new Map();
  for(const e of entries){if(e.id!==null){if(!Number.isSafeInteger(e.id)||e.id<=0)throw Error('Invalid database sync identity');if(byId.has(e.id))throw Error('Two database files claim the same sync identity');byId.set(e.id,e);}}
  const source=new Map(b.collections().map(c=>[c.id,c]));
  const known=new Map(b.ledger.prepare('SELECT * FROM sync_collections WHERE deleted=0').all().map(m=>[m.id,m]));
  for(const m of known.values()){
    const l=source.get(m.id),r=byId.get(m.id);
    if(l)resetMissing(b,m.id,'left');if(r)resetMissing(b,m.id,'right');
    try{
      if(!l&&!r){b.ledger.prepare('UPDATE sync_collections SET deleted=1 WHERE id=?').run(m.id);continue;}
      if(!l){
        if(!absentTwice(b,m.id,'left'))continue;
        const db=openEn(r.file);let unchanged;try{unchanged=rightUnchanged(b,m,db);}finally{db.close();}
        if(!unchanged||r.relative!==m.relative||r.title!==m.name)throw Error('Deleted in Novelty but changed in En Croissant');
        if(!canMove())throw Error('Close En Croissant to finish a database deletion');
        if(fs.existsSync(r.file+'-wal')||fs.existsSync(r.file+'-journal'))throw Error('Database still has an active transaction');
        const recovered=path.join(b.recoveryRoot,randomUUID());fs.mkdirSync(recovered,{recursive:true});
        saveRecovery(b,'deleted-en-collection',{mapping:m,destination:recovered});
        fs.renameSync(r.file,path.join(recovered,path.basename(r.file)));
        for(const companion of [r.file.replace(/\.db3$/i,'.ecsi'),r.file+'.mistake-review.json'])if(fs.existsSync(companion))fs.renameSync(companion,path.join(recovered,path.basename(companion)));
        b.ledger.prepare('UPDATE sync_collections SET deleted=1 WHERE id=?').run(m.id);report.changed++;continue;
      }
      if(!r){
        if(!absentTwice(b,m.id,'right'))continue;
        transaction(b.source,()=>{
          const latest=b.source.prepare('SELECT id,name,folder FROM collection WHERE id=?').get(m.id);
          if(!latest||latest.name!==m.name||latest.folder!==m.folder||!leftUnchanged(b,m))throw Error('Deleted in En Croissant but changed in Novelty');
          // Keep exact PGNs and identities; position hits can be rebuilt from
          // these games and must not duplicate a multi-gigabyte derived index.
          saveRecovery(b,'deleted-novelty-collection',{collection:latest,games:b.source.prepare('SELECT * FROM game_record WHERE collection_id=?').all(m.id)});
          b.source.prepare('DELETE FROM position_hit WHERE game_id IN (SELECT id FROM game_record WHERE collection_id=?)').run(m.id);
          b.source.prepare('DELETE FROM game_record WHERE collection_id=?').run(m.id);
          b.source.prepare('DELETE FROM collection WHERE id=?').run(m.id);b.bumpSource();
        });
        b.ledger.prepare('UPDATE sync_collections SET deleted=1 WHERE id=?').run(m.id);report.changed++;continue;
      }
      const lc=l.name!==m.name||l.folder!==m.folder,rc=r.relative!==m.relative||r.title!==m.name;
      if(lc&&rc)throw Error('Database name or folder changed in both apps');
      if(lc){
        const next=collectionPath(l);
        if(next!==r.relative){
          if(!canMove())throw Error('Close En Croissant to finish a database rename');
          if(fs.existsSync(r.file+'-wal')||fs.existsSync(r.file+'-journal'))throw Error('Database still has an active transaction');
          const dest=b.path(next);if(fs.existsSync(dest))throw Error('Database rename destination exists');fs.mkdirSync(path.dirname(dest),{recursive:true});
          saveRecovery(b,'renamed-en-collection',{mapping:m,next});fs.renameSync(r.file,dest);
          // Derived indexes follow the file; their normal timestamp validation
          // still applies. A failed companion move is surfaced, never deleted.
          for(const ext of ['.ecsi']){const old=r.file.replace(/\.db3$/i,ext),target=dest.replace(/\.db3$/i,ext);if(fs.existsSync(old)){if(fs.existsSync(target))throw Error('Database companion destination exists');fs.renameSync(old,target);}}
          r.file=dest;r.relative=next;
        }
        const db=openEn(r.file);try{db.prepare("UPDATE Info SET Value=? WHERE Name='Title'").run(l.name);}finally{db.close();}
        b.ledger.prepare('UPDATE sync_collections SET relative=?,name=?,folder=? WHERE id=?').run(r.relative,l.name,l.folder,l.id);report.changed++;
      }else if(rc){
        const renamed=path.posix.basename(r.relative)!==path.posix.basename(m.relative);
        const name=r.title!==m.name?r.title:renamed?path.posix.basename(r.relative).replace(/\.db3$/i,'').replace(/ \[\d+\]$/,''):m.name;
        const folder=path.posix.dirname(r.relative)==='.'?null:path.posix.dirname(r.relative);
        if(!name.trim())throw Error('Database name is empty');
        transaction(b.source,()=>{
          const now=b.source.prepare('SELECT name,folder FROM collection WHERE id=?').get(m.id);
          if(!now||now.name!==m.name||now.folder!==m.folder)throw Error('Database changed during rename');
          saveRecovery(b,'renamed-novelty-collection',m);b.source.prepare('UPDATE collection SET name=?,folder=? WHERE id=?').run(name,folder,m.id);b.bumpSource();
        });
        const db=openEn(r.file);try{db.prepare("UPDATE Info SET Value=? WHERE Name='Title'").run(name);}finally{db.close();}
        b.ledger.prepare('UPDATE sync_collections SET relative=?,name=?,folder=? WHERE id=?').run(r.relative,name,folder,m.id);report.changed++;
      }
    }catch(error){report.conflicts.push({collection:m.id,reason:error.message});}
  }
  for(const c of source.values())if(!known.has(c.id)){
    try{
      const deleted=b.ledger.prepare('SELECT * FROM sync_collections WHERE id=?').get(c.id);
      if(deleted){
        if(byId.has(c.id))throw Error('A previously deleted database was restored while its ID was reused');
        // Novelty's INTEGER PRIMARY KEY may reuse the highest deleted ID.
        // Preserve the old generation before recording the new collection.
        transaction(b.ledger,()=>{saveRecovery(b,'reused-collection-id',{mapping:deleted,games:baseGames(b,c.id)});b.ledger.prepare('DELETE FROM sync_games WHERE collection_id=?').run(c.id);b.ledger.prepare('DELETE FROM sync_collections WHERE id=?').run(c.id);});
      }
      const relative=collectionPath(c),file=b.path(relative);if(fs.existsSync(file))throw Error('New database destination already exists');
      fs.mkdirSync(path.dirname(file),{recursive:true});const db=openEn(file,{create:true,name:c.name,syncId:String(c.id)});db.close();
      b.ledger.prepare('INSERT INTO sync_collections(id,relative,name,folder,initialized) VALUES(?,?,?,?,1)').run(c.id,relative,c.name,c.folder);report.changed++;
    }catch(error){report.errors.push({collection:c.id,error:error.message});}
  }
  for(const r of entries)if(r.id===null){
    try{
      const folder=path.posix.dirname(r.relative)==='.'?null:path.posix.dirname(r.relative);
      let id;
      // A named intent in the source makes a crash after collection creation
      // recoverable before the En file receives its identity.
      const intent=`personal-sync:new:${r.relative}`;
      transaction(b.source,()=>{
        const old=b.source.prepare('SELECT value FROM meta WHERE key=?').get(intent);
        if(old){id=Number(old.value);if(!b.source.prepare('SELECT id FROM collection WHERE id=?').get(id))throw Error('New collection recovery requires review');return;}
        id=Number(b.source.prepare('INSERT INTO collection(name,folder) VALUES(?,?)').run(r.title,folder).lastInsertRowid);
        b.source.prepare('INSERT INTO meta VALUES(?,?)').run(intent,String(id));b.bumpSource();
      });
      const db=openEn(r.file);try{db.prepare("INSERT INTO Info(Name,Value) VALUES('PersonalSyncId',?)").run(String(id));}finally{db.close();}
      b.ledger.prepare('INSERT INTO sync_collections(id,relative,name,folder,initialized) VALUES(?,?,?,?,1)').run(id,r.relative,r.title,folder);report.changed++;
    }catch(error){report.errors.push({path:r.relative,error:error.message});}
  }
  return report;
}
