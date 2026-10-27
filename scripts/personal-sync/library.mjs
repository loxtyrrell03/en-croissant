import fs from 'node:fs/promises';
import path from 'node:path';
import {parsePgn,makePgn} from 'chessops/pgn';
import {digest,scan,readItem,applyItem} from './files.mjs';
import {buildHostedLibraryIndex,listHostedLibraryDirectory,getHostedLibraryScope} from '../home-library-index.mjs';
import {transaction} from './en-database.mjs';
import {archiveSnapshot,buildArchiveTargets,writeArchive} from './archives.mjs';

const tagPrefix='PersonalSync';
export function portablePgn(pgn){
  const games=parsePgn(pgn);if(games.length!==1)throw Error('Expected exactly one saved game');
  for(const key of games[0].headers.keys())if(key.startsWith(tagPrefix))games[0].headers.delete(key);
  return makePgn(games[0]);
}
export function stampPgn(pgn,ref,revision){
  const clean=portablePgn(pgn),game=parsePgn(clean)[0];
  game.headers.set('PersonalSyncRef',ref);game.headers.set('PersonalSyncRevision',revision);game.headers.set('PersonalSyncBase',digest(clean));
  return makePgn(game);
}
export function readReference(ref){
  const match=/^database:(\d+):(\d+)$/.exec(ref);
  if(match)return{kind:'database',collection:Number(match[1]),game:Number(match[2]),scope:`database:${match[1]}:${match[2]}`};
  const file=/^file:(.+):(\d+)$/.exec(ref);
  if(file)return{kind:'file',path:file[1],index:Number(file[2]),scope:`file:${file[1]}`};
  throw Error('This game is not linked to the shared library');
}

export class PersonalLibrary {
  constructor({bridge,filesRoot,recoveryRoot,id='local',referenceDatabases=[]}){this.bridge=bridge;this.filesRoot=filesRoot;this.recoveryRoot=recoveryRoot;this.id=id;this.referenceDatabases=referenceDatabases;this.version='';this.catalog=null;this.stamps=new Map();this.revision='';}
  async refresh(){
    const files=await scan(this.filesRoot),db=this.bridge.source;
    const version=String(db.prepare("SELECT value FROM meta WHERE key='data_version'").get()?.value??'0');
    const collections=db.prepare('SELECT c.id,c.name,c.folder,count(g.id) gameCount FROM collection c LEFT JOIN game_record g ON g.collection_id=c.id GROUP BY c.id ORDER BY c.id').all();
    const mappings=new Map(this.bridge.ledger.prepare('SELECT id,relative FROM sync_collections WHERE deleted=0').all().map(r=>[r.id,r.relative]));
    const manifest={version:1,generatedAt:new Date().toISOString(),sourceName:'Shared chess library',pinnedPaths:[],files:[]};
    const stamp=(key,signature)=>{const old=this.stamps.get(key);if(old?.signature===signature)return old.at;const at=Date.now();this.stamps.set(key,{signature,at});return at;};
    const byVirtual=new Map(),byCollection=new Map();
    const fileUrl=relative=>'files/__personal/'+this.id+'/'+relative.split('/').map(encodeURIComponent).join('/');
    for(const [relative,item] of files){
      if(item.kind!=='file'||!/\.(pgn|pdf)$/i.test(relative))continue;
      const extension=path.extname(relative).slice(1).toLowerCase(),filename=path.basename(relative);
      // The phone's existing file surface supports chess PGNs and PDFs. Other
      // file types remain synchronized between the two desktop file trees.
      manifest.files.push({type:'file',name:filename.replace(/\.(pgn|pdf)$/i,''),filename,extension,path:relative,url:fileUrl(relative),lastModified:stamp(relative,item.hash),sizeBytes:item.size});
      byVirtual.set(relative,{kind:'file',relative});
    }
    for(const c of collections){
      const mapping=mappings.get(c.id);if(!mapping)continue;
      const hostedPath='Databases/Desktop/'+mapping.replace(/\.db3$/i,''),virtual=hostedPath+'/games.pgn';
      const signature=JSON.stringify([version,c.name,c.folder,c.gameCount]);
      const entry={...c,hostedPath,lastModified:stamp(`database:${c.id}`,signature)};
      if(byVirtual.has(virtual))throw Error('A personal file collides with the database catalogue');
      byCollection.set(hostedPath,entry);byVirtual.set(virtual,{kind:'database',collection:c.id});
      manifest.files.push({type:'file',name:c.name,databaseName:c.name,databaseLabel:[c.folder,c.name].filter(Boolean).join(' / '),filename:'games.pgn',extension:'pgn',path:virtual,url:fileUrl(virtual),lastModified:entry.lastModified,sizeBytes:0});
    }
    const index=buildHostedLibraryIndex(manifest);
    for(const entries of index.listings.values())for(const entry of entries){const collection=byCollection.get(entry.path);if(collection)entry.name=collection.name;}
    // Preserve empty physical folders, which static PGN export cannot express.
    for(const [relative,item]of files)if(item.kind==='directory'){
      const parent=path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative);
      if(!index.listings.has(relative))index.listings.set(relative,[]);
      const siblings=index.listings.get(parent)??[];
      if(!siblings.some(e=>e.path===relative))siblings.push({type:'directory',path:relative,name:path.posix.basename(relative),lastModified:0,sizeBytes:0,pgnFileCount:0,directPgnFileCount:0});
      siblings.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1);index.listings.set(parent,siblings);
    }
    this.catalog={manifest,index,byVirtual,byCollection,archiveTargets:buildArchiveTargets(files,byCollection)};this.version=version;
    this.revision=digest(JSON.stringify({version,collections,archives:this.archives().revision,files:[...files].map(([p,v])=>[p,v.kind,v.hash])}));
    return{collections:collections.length,files:files.size};
  }
  archives(){
    if(!this.catalog)return undefined;
    return archiveSnapshot(this.bridge.source,this.catalog.archiveTargets,this.id);
  }
  setArchive(body){return writeArchive({db:this.bridge.source,ledger:this.bridge.ledger,targets:this.catalog?.archiveTargets??new Map(),id:this.id,body});}
  manifest(url){
    if(!this.catalog)throw Error('Shared library is loading');
    const scope=url.searchParams.get('scope'),relative=url.searchParams.get('path')??'';
    if(scope==='directory')return listHostedLibraryDirectory(this.catalog.index,relative);
    if(scope==='recursive')return getHostedLibraryScope(this.catalog.index,relative);
    return{...this.catalog.manifest,databases:[...[...this.catalog.byCollection.values()].map(c=>({type:'database',path:c.hostedPath,name:c.name,label:[c.folder,c.name].filter(Boolean).join(' / '),gameCount:c.gameCount,sizeBytes:0,lastModified:c.lastModified,latestDate:null})),...this.referenceDatabases.map(c=>({...c,readOnly:true}))]};
  }
  async raw(relative){
    if(relative.startsWith(`__personal/${this.id}/`))relative=relative.slice(`__personal/${this.id}/`.length);
    const entry=this.catalog?.byVirtual.get(relative);if(!entry)throw Error('Shared file was moved or removed');
    if(entry.kind==='database'){
      const games=this.bridge.source.prepare('SELECT id,pgn FROM game_record WHERE collection_id=? ORDER BY id').all(entry.collection);
      return{type:'application/x-chess-pgn; charset=utf-8',bytes:Buffer.from(games.map(g=>stampPgn(g.pgn,`database:${entry.collection}:${g.id}`,digest(g.pgn))).join('\n\n'))};
    }
    const item=await readItem(this.filesRoot,entry.relative);if(item?.kind!=='file')throw Error('Shared file was moved or removed');
    if(/\.pdf$/i.test(relative))return{type:'application/pdf',bytes:item.bytes};
    const games=parsePgn(item.bytes.toString('utf8'));
    return{type:'application/x-chess-pgn; charset=utf-8',bytes:Buffer.from(games.map((g,i)=>stampPgn(makePgn(g),`file:${relative}:${i}`,digest(makePgn(g)))).join('\n\n'))};
  }
  async game(ref){
    const parsed=readReference(ref);
    if(parsed.kind==='database'){
      const row=this.bridge.source.prepare('SELECT pgn FROM game_record WHERE collection_id=? AND id=?').get(parsed.collection,parsed.game);
      if(!row)throw Error('Shared game was removed');return{ref,revision:digest(row.pgn),scope:parsed.scope,pgn:stampPgn(row.pgn,ref,digest(row.pgn))};
    }
    const item=await readItem(this.filesRoot,parsed.path);if(item?.kind!=='file')throw Error('Shared file was moved or removed');
    const game=parsePgn(item.bytes.toString('utf8'))[parsed.index];if(!game)throw Error('Shared game was removed');
    const revision=digest(makePgn(game));return{ref,revision,scope:ref,pgn:stampPgn(makePgn(game),ref,revision)};
  }
  async save({ref,revision,pgn}){
    if(typeof pgn!=='string'||Buffer.byteLength(pgn)>8*1024*1024)throw Error('Saved game is too large');
    if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw Error('Original game revision is required');
    const parsed=readReference(ref),clean=portablePgn(pgn);
    // Validate with the native format before publishing anything.
    await this.bridge.codec.request({pgn:clean});
    if(parsed.kind==='database'){
      const current=this.bridge.source.prepare('SELECT pgn FROM game_record WHERE collection_id=? AND id=?').get(parsed.collection,parsed.game);
      if(!current||digest(current.pgn)!==revision){const e=Error('This game changed on the PC. Your phone edits are preserved.');e.status=409;throw e;}
      this.bridge.recoverGame(parsed.collection,parsed.game,'phone-replaced-game');
      await this.bridge.native.request({library:this.bridge.library,id:parsed.game,expected:current.pgn,pgn:clean});
    }else{
      if(!/\.pgn$/i.test(parsed.path))throw Error('Only PGN files can be edited as games');
      const item=await readItem(this.filesRoot,parsed.path);
      if(item?.kind!=='file')throw Error('Shared file was moved or removed');
      const games=parsePgn(item.bytes.toString('utf8'));if(!games[parsed.index])throw Error('Shared game was removed');
      if(digest(makePgn(games[parsed.index]))!==revision){const e=Error('This game changed on the PC. Your phone edits are preserved.');e.status=409;throw e;}
      games[parsed.index]=parsePgn(clean)[0];const bytes=Buffer.from(games.map(makePgn).join('\n\n'));
      await applyItem({root:this.filesRoot,relative:parsed.path,expected:item,next:{kind:'file',hash:digest(bytes),bytes},recovery:this.recoveryRoot});
    }
    await this.refresh();return this.game(ref);
  }
  async importDatabase({clientId,name,pgn}){
    if(typeof clientId!=='string'||!clientId||clientId.length>200||typeof name!=='string'||!name.trim()||name.length>160||typeof pgn!=='string')throw Error('Invalid phone database');
    const games=parsePgn(pgn);if(!games.length)throw Error('This database contains no saved games');
    const checked=[],identities=new Set();
    for(const game of games){
      const raw=portablePgn(makePgn(game));await this.bridge.codec.request({pgn:raw});
      const validated=await this.bridge.native.request({library:this.bridge.library,pgn:raw,validate:true});
      if(identities.has(validated.fingerprint))throw Error('This import contains repeated game identities. Keep the phone copy and remove duplicates before syncing it.');
      identities.add(validated.fingerprint);checked.push(validated.pgn);
    }
    const signature=digest(JSON.stringify({name,games:checked})),key=`personal-sync:phone-import:${clientId}`;
    let receipt;
    transaction(this.bridge.source,()=>{
      const previous=this.bridge.source.prepare('SELECT value FROM meta WHERE key=?').get(key);
      if(previous){receipt=JSON.parse(previous.value);if(receipt.signature!==signature)throw Error('This phone import changed before it finished. Its existing games were preserved.');return;}
      let title=name.trim().replace(/\.pgn$/i,''),suffix=1;
      while(this.bridge.source.prepare('SELECT id FROM collection WHERE name=?').get(title)){title=`${name.trim().replace(/\.pgn$/i,'')} (phone ${suffix++})`;}
      const id=Number(this.bridge.source.prepare("INSERT INTO collection(name,folder) VALUES(?,'Phone imports')").run(title).lastInsertRowid);
      receipt={id,name:title,signature};this.bridge.source.prepare('INSERT INTO meta VALUES(?,?)').run(key,JSON.stringify(receipt));this.bridge.bumpSource();
    });
    if(!this.bridge.source.prepare('SELECT id FROM collection WHERE id=?').get(receipt.id))throw Error('The phone import database was removed; its phone copy is preserved');
    const imported=[];
    for(const game of checked){const result=await this.bridge.native.request({library:this.bridge.library,collection:receipt.id,pgn:game});imported.push(await this.game(`database:${receipt.id}:${result.id}`));}
    await this.refresh();return{collection:receipt.id,name:receipt.name,games:imported};
  }
  position(hostedPath,fen){
    const collection=this.catalog?.byCollection.get(hostedPath);if(!collection)throw Error('Shared database was removed');
    return this.bridge.source.prepare(`SELECT ph.next_san move,SUM(ph.result='1-0') white,SUM(ph.result='1/2-1/2') draw,SUM(ph.result='0-1') black,MAX(g.game_date) lastPlayed FROM position_hit ph JOIN game_record g ON g.id=ph.game_id WHERE ph.position_key=? AND g.collection_id=? AND ph.next_san IS NOT NULL GROUP BY ph.next_san ORDER BY COUNT(*) DESC LIMIT 100`).all(fen,collection.id).map(r=>({...r,uci:null}));
  }
}
