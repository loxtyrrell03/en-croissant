import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {digest} from './files.mjs';
import {openEn,enRows,enRow,rowHash,writeEncoded,transaction,refreshCounts,pgnFromRow,encodedMatches} from './en-database.mjs';
import {reconcileContainers} from './containers.mjs';

export function safeName(name){
  let result=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,110);
  if(!result || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(result))result='_'+result;
  return result;
}
export function collectionPath(collection){
  const folders=(collection.folder??'').split(/[\\/]/).filter(Boolean).map(safeName);
  return [...folders,`${safeName(collection.name)} [${collection.id}].db3`].join('/');
}
function openLedger(file){
  fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sync_collections(id INTEGER PRIMARY KEY,relative TEXT UNIQUE NOT NULL,name TEXT NOT NULL,folder TEXT,initialized INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sync_games(collection_id INTEGER NOT NULL,right_id INTEGER NOT NULL,left_id INTEGER,base_pgn TEXT,right_hash TEXT,PRIMARY KEY(collection_id,right_id));
    CREATE UNIQUE INDEX IF NOT EXISTS sync_left_game ON sync_games(left_id) WHERE left_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS recovery(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
}
const baselineRow=(ledger,collectionId,rightId,leftId,pgn,rightHash)=>ledger.prepare('INSERT INTO sync_games(collection_id,right_id,left_id,base_pgn,right_hash) VALUES(?,?,?,?,?) ON CONFLICT(collection_id,right_id) DO UPDATE SET left_id=excluded.left_id,base_pgn=excluded.base_pgn,right_hash=excluded.right_hash').run(collectionId,rightId,leftId,pgn,rightHash);
const backup=(ledger,kind,payload)=>ledger.prepare('INSERT INTO recovery VALUES(?,?,?,?)').run(randomUUID(),kind,JSON.stringify(payload,(_,v)=>typeof v==='bigint'?{integer:String(v)}:v instanceof Uint8Array?{hex:Buffer.from(v).toString('hex')}:v),new Date().toISOString());
const sourceRows=(db,id)=>db.prepare('SELECT id,pgn FROM game_record WHERE collection_id=? ORDER BY id').all(id);

export class DatabaseSyncBridge {
  constructor({library,enRoot,ledger,codec,native,recoveryRoot=ledger+'.recovery',canMove=()=>false,referencePaths=[]}){
    const canonical=fs.realpathSync.native(library);
    if(path.basename(canonical)!=='library.sqlite' || path.basename(path.dirname(canonical))!=='app.outpost.chess.dev')throw Error('Personal sync only accepts the physical Novelty Dev library');
    this.library=library;this.enRoot=enRoot;this.codec=codec;this.native=native;this.recoveryRoot=recoveryRoot;this.canMove=canMove;this.referencePaths=referencePaths;
    this.source=new DatabaseSync(library);this.source.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    this.ledger=openLedger(ledger);
    const identity=JSON.stringify({library:fs.realpathSync.native(library),enRoot:path.resolve(enRoot)});
    const old=this.ledger.prepare("SELECT value FROM sync_meta WHERE key='identity'").get()?.value;
    if(old && old!==identity)throw Error('Personal database sync identity changed');
    this.ledger.prepare("INSERT OR IGNORE INTO sync_meta VALUES('identity',?)").run(identity);
  }
  close(){this.source.close();this.ledger.close();}
  path(relative){const target=path.resolve(this.enRoot,...relative.split('/'));if(!target.startsWith(path.resolve(this.enRoot)+path.sep))throw Error('Database escaped sync root');return target;}
  collections(){return this.source.prepare('SELECT id,name,folder FROM collection ORDER BY id').all();}
  async initialize({onProgress=()=>{}}={}){
    fs.mkdirSync(this.enRoot,{recursive:true});
    if(this.ledger.prepare("SELECT value FROM sync_meta WHERE key='initialized'").get())throw Error('Database sync is already initialized');
    const report={collections:0,games:0,errors:[]};
    for(const c of this.collections()){
      let mapped=this.ledger.prepare('SELECT * FROM sync_collections WHERE id=?').get(c.id);
      if(!mapped){this.ledger.prepare('INSERT INTO sync_collections(id,relative,name,folder) VALUES(?,?,?,?)').run(c.id,collectionPath(c),c.name,c.folder);mapped=this.ledger.prepare('SELECT * FROM sync_collections WHERE id=?').get(c.id);}
      const file=this.path(mapped.relative);fs.mkdirSync(path.dirname(file),{recursive:true});
      const en=openEn(file,{create:!fs.existsSync(file),name:c.name,syncId:String(c.id)});
      try{
        const games=sourceRows(this.source,c.id), existing=new Map(enRows(en).map(row=>[row.ID,row]));
        // The target is an unpublished staging database. Batch its writes so
        // conversion does not perform a disk flush for every imported game.
        en.exec('BEGIN IMMEDIATE');this.ledger.exec('BEGIN IMMEDIATE');
        for(const game of games){
          const old=this.ledger.prepare('SELECT * FROM sync_games WHERE collection_id=? AND right_id=?').get(c.id,game.id);
          if(old?.base_pgn===game.pgn && old.right_hash===rowHash(existing.get(game.id))){report.games++;continue;}
          try{
            const encoded=await this.codec.request({pgn:game.pgn});
            const current=this.source.prepare('SELECT pgn FROM game_record WHERE id=? AND collection_id=?').get(game.id,c.id);
            if(current?.pgn!==game.pgn)throw Error('Source changed during conversion');
            const hash=writeEncoded(en,{id:game.id,encoded,expected:rowHash(existing.get(game.id))});
            baselineRow(this.ledger,c.id,game.id,game.id,game.pgn,hash);report.games++;
            if(report.games%1000===0)onProgress({collection:c.id,collections:report.collections,games:report.games,errors:report.errors.length});
          }catch(error){report.errors.push({collection:c.id,game:game.id,error:error.message});}
        }
        if(existing.size && [...existing.keys()].some(id=>!games.some(g=>g.id===id)))throw Error('Source changed during initial snapshot; staged games require review');
        refreshCounts(en);
        if(!report.errors.some(e=>e.collection===c.id))this.ledger.prepare('UPDATE sync_collections SET initialized=1 WHERE id=?').run(c.id);
        en.exec('COMMIT');this.ledger.exec('COMMIT');
        report.collections++;onProgress({collection:c.id,collections:report.collections,games:report.games,errors:report.errors.length});
      }catch(error){try{en.exec('ROLLBACK');}catch{}try{this.ledger.exec('ROLLBACK');}catch{}throw error;}finally{en.close();}
    }
    if(!report.errors.length)this.ledger.prepare("INSERT INTO sync_meta VALUES('initialized','1')").run();
    return report;
  }
  recoverGame(collection,id,kind){
    const gameStatement=this.source.prepare('SELECT * FROM game_record WHERE id=? AND collection_id=?');gameStatement.setReadBigInts(true);
    const game=gameStatement.get(id,collection);
    const hitStatement=this.source.prepare('SELECT * FROM position_hit WHERE game_id=?');hitStatement.setReadBigInts(true);
    if(game)backup(this.ledger,kind,{game,hits:hitStatement.all(id)});
  }
  deleteSourceGame(collection,id,expected){
    transaction(this.source,()=>{
      const game=this.source.prepare('SELECT pgn FROM game_record WHERE id=? AND collection_id=?').get(id,collection);
      if(game?.pgn!==expected)throw Error('Concurrent source edit before deletion');
      this.recoverGame(collection,id,'deleted-novelty-game');
      this.source.prepare('DELETE FROM position_hit WHERE game_id=?').run(id);
      this.source.prepare('DELETE FROM game_record WHERE id=? AND collection_id=? AND pgn=?').run(id,collection,expected);
      this.bumpSource();
    });
  }
  bumpSource(){this.source.exec("INSERT INTO meta(key,value) VALUES('data_version','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)");}
  async tick(){
    if(!this.ledger.prepare("SELECT value FROM sync_meta WHERE key='initialized'").get())throw Error('Initial database conversion is not complete');
    const report=await reconcileContainers(this,{collectionPath,canMove:this.canMove});
    const collections=new Map(this.collections().map(c=>[c.id,c]));
    for(const mapped of this.ledger.prepare('SELECT * FROM sync_collections WHERE deleted=0').all()){
      const c=collections.get(mapped.id),file=this.path(mapped.relative);
      // Collection removals and path moves are reconciled separately; never
      // interpret a missing container as deletion of every contained game.
      if(!c || !fs.existsSync(file)){report.conflicts.push({collection:mapped.id,reason:'Collection was removed or moved; container reconciliation required'});continue;}
      const en=openEn(file);
      const changedBefore=report.changed;
      try{
        const left=new Map(sourceRows(this.source,c.id).map(g=>[g.id,g])),right=new Map(enRows(en).map(g=>[g.ID,g]));
        const bases=this.ledger.prepare('SELECT * FROM sync_games WHERE collection_id=?').all(c.id);
        for(const base of bases){
          const l=left.get(base.left_id),r=right.get(base.right_id),rh=rowHash(r);
          left.delete(base.left_id);right.delete(base.right_id);
          const lc=(l?.pgn??null)!==base.base_pgn,rc=rh!==base.right_hash;
          if(!lc&&!rc)continue;
          if(lc&&rc){
            if(!l&&!r){this.ledger.prepare('DELETE FROM sync_games WHERE collection_id=? AND right_id=?').run(c.id,base.right_id);continue;}
            // Adopt an uncertain completed write only when both native
            // representations exactly match; otherwise keep both versions.
            if(l&&r){try{const encoded=await this.codec.request({pgn:l.pgn});if(encodedMatches(r,encoded)){baselineRow(this.ledger,c.id,r.ID,l.id,l.pgn,rh);continue;}}catch(error){report.errors.push({collection:c.id,game:l.id,error:error.message});continue;}}
            report.conflicts.push({collection:c.id,game:base.left_id,reason:'Both copies changed'});continue;
          }
          try{
            if(lc){
              if(l){const encoded=await this.codec.request({pgn:l.pgn});const newHash=transaction(en,()=>{backup(this.ledger,'changed-en-game',r);return writeEncoded(en,{id:base.right_id,encoded,expected:rh});});baselineRow(this.ledger,c.id,base.right_id,l.id,l.pgn,newHash);}
              else{transaction(en,()=>{if(rowHash(enRow(en,base.right_id))!==rh)throw Error('Concurrent En deletion conflict');backup(this.ledger,'deleted-en-game',r);en.prepare('DELETE FROM Games WHERE ID=?').run(base.right_id);});this.ledger.prepare('DELETE FROM sync_games WHERE collection_id=? AND right_id=?').run(c.id,base.right_id);}
            }else if(r){
              const pgn=await pgnFromRow(r,this.codec,base.base_pgn);this.recoverGame(c.id,base.left_id,'changed-novelty-game');
              const result=await this.native.request({library:this.library,id:base.left_id,expected:base.base_pgn,pgn});
              const saved=this.source.prepare('SELECT pgn FROM game_record WHERE id=?').get(result.id).pgn;
              baselineRow(this.ledger,c.id,base.right_id,result.id,saved,rh);
            }else{
              this.deleteSourceGame(c.id,base.left_id,base.base_pgn);this.ledger.prepare('DELETE FROM sync_games WHERE collection_id=? AND right_id=?').run(c.id,base.right_id);
            }
            report.changed++;
          }catch(error){report.errors.push({collection:c.id,game:base.left_id,error:error.message});}
        }
        let nextRightId=en.prepare('SELECT COALESCE(MAX(ID),0)+1 id FROM Games').get().id;
        for(const l of left.values()){
          try{const encoded=await this.codec.request({pgn:l.pgn});const rightId=nextRightId++;baselineRow(this.ledger,c.id,rightId,l.id,null,null);const hash=transaction(en,()=>writeEncoded(en,{id:rightId,encoded,expected:null}));baselineRow(this.ledger,c.id,rightId,l.id,l.pgn,hash);report.changed++;}catch(error){report.errors.push({collection:c.id,game:l.id,error:error.message});}
        }
        for(const r of right.values()){
          try{const pgn=await pgnFromRow(r,this.codec);const result=await this.native.request({library:this.library,collection:c.id,pgn});const saved=this.source.prepare('SELECT pgn FROM game_record WHERE id=?').get(result.id).pgn;baselineRow(this.ledger,c.id,r.ID,result.id,saved,rowHash(r));report.changed++;}catch(error){report.errors.push({collection:c.id,game:r.ID,error:error.message});}
        }
        if(report.changed!==changedBefore)transaction(en,()=>refreshCounts(en));
      }finally{en.close();}
    }
    return report;
  }
}
