import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {syncFiles,atomicJson} from './files.mjs';
import {DatabaseSyncBridge} from './databases.mjs';
import {JsonLineProcess} from './rpc.mjs';
import {PersonalLibrary} from './library.mjs';

export function validateConfig(c){
  if(c.version!==1||c.enabled!==true||c.port!==8788||!/^[a-f0-9]{64}$/.test(c.secret??''))throw Error('Personal sync is not configured or enabled');
  const physical=fsSync.realpathSync.native(c.library);
  const expected=path.join(process.env.APPDATA,'app.outpost.chess.dev','library.sqlite');
  if(physical.toLowerCase()!==expected.toLowerCase())throw Error('Only the unredirected Novelty Dev profile is allowed');
  for(const root of [c.filesRoot,c.enFilesRoot,c.enRoot,c.stateRoot]){
    if(!path.isAbsolute(root)||!fsSync.lstatSync(root).isDirectory()||fsSync.lstatSync(root).isSymbolicLink())throw Error('A sync root is unavailable or redirected');
    const actual=fsSync.realpathSync.native(root);if(actual.toLowerCase()!==path.resolve(root).toLowerCase())throw Error('A sync root resolves to another location');
    if(actual.toLowerCase().includes('app.outpost.chess'+path.sep))throw Error('Production Novelty is excluded');
  }
  if(!fsSync.existsSync(path.join(c.enRoot,'.personal-sync-root.json')))throw Error('Initialized database root marker is missing');
  const marker=JSON.parse(fsSync.readFileSync(path.join(c.enRoot,'.personal-sync-root.json'),'utf8'));
  if(marker.id!==c.id)throw Error('Database root identity changed');
}
const isEnClosed=()=>process.platform!=='win32'||spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if(Get-Process -Name 'en-croissant','encroissant' -ErrorAction SilentlyContinue){exit 1}else{exit 0}"],{windowsHide:true,timeout:10000}).status===0;
export async function startRunner(c){
  validateConfig(c);
  const lockPath=path.join(c.stateRoot,'runner.lock'),nonce=randomUUID();
  try{const old=JSON.parse(await fs.readFile(lockPath,'utf8'));try{process.kill(old.pid,0);throw Error('Personal sync is already running');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.writeFile(lockPath,JSON.stringify({pid:process.pid,nonce}),{flag:'wx'});
  const codec=new JsonLineProcess(c.codec),native=new JsonLineProcess(c.native);
  const bridge=new DatabaseSyncBridge({library:c.library,enRoot:c.enRoot,ledger:path.join(c.stateRoot,'database-ledger.sqlite'),codec,native,recoveryRoot:path.join(c.stateRoot,'recovery','databases'),canMove:isEnClosed,referencePaths:c.referencePaths??[],cacheUnchanged:true});
  if(bridge.source.prepare("SELECT value FROM meta WHERE key='files.root'").get()?.value.replaceAll('\\','/').toLowerCase()!==c.filesRoot.replaceAll('\\','/').toLowerCase())throw Error('Novelty Dev selected a different Files folder');
  const library=new PersonalLibrary({bridge,filesRoot:c.filesRoot,recoveryRoot:path.join(c.stateRoot,'recovery','phone-files'),id:c.id,referenceDatabases:c.referenceDatabases??[]});
  let status={enabled:true,id:c.id,phase:'starting',lastSuccess:null,conflicts:[],errors:[]},queue=Promise.resolve(),closed=false;
  const serial=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
  let phoneQueue=Promise.resolve();
  const phoneWrite=work=>{const next=phoneQueue.then(work);phoneQueue=next.catch(()=>{});return next;};
  const writeStatus=()=>atomicJson(path.join(c.stateRoot,'status.json'),status);
  let pendingTick=null;
  const tick=()=>pendingTick??(pendingTick=serial(async()=>{
    status={...status,phase:'syncing',checking:'files',errors:[]};await writeStatus();
    try{
      validateConfig(c);
      const started=Date.now();
      const files=await syncFiles({leftRoot:c.filesRoot,rightRoot:c.enFilesRoot,statePath:path.join(c.stateRoot,'files.json'),recovery:path.join(c.stateRoot,'recovery','files')});
      const filesDone=Date.now();status={...status,checking:'databases'};await writeStatus();
      const databases=await bridge.tick(),databasesDone=Date.now();status={...status,checking:'catalog'};await writeStatus();await library.refresh();
      const conflicts=[...files.conflicts.map(path=>({path,reason:'Changed in both apps'})),...databases.conflicts];
      status={...status,revision:library.revision,phase:conflicts.length||databases.errors.length?'attention':'synced',lastSuccess:conflicts.length||databases.errors.length?status.lastSuccess:new Date().toISOString(),conflicts,errors:databases.errors,checkedAt:new Date().toISOString(),changedFiles:files.changed.length,changedGames:databases.changed,timingsMs:{files:filesDone-started,databases:databasesDone-filesDone,catalog:Date.now()-databasesDone}};
    }catch(e){status={...status,phase:'attention',errors:[{error:e.message}],checkedAt:new Date().toISOString()};}
    await writeStatus();
  }).finally(()=>{pendingTick=null;}));
  const json=(res,code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const server=createServer((req,res)=>{
    void (async()=>{
      const supplied=Buffer.from(String(req.headers['x-personal-sync-key']??'')),expected=Buffer.from(c.secret);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,403,{error:'Private sync access required'});
      const url=new URL(req.url,'http://127.0.0.1'),pathname=decodeURIComponent(url.pathname);
      if(req.method==='GET'&&pathname==='/api/personal-sync/status')return json(res,200,status);
      if(req.method==='POST'&&pathname==='/api/personal-sync/retry'){void tick();return json(res,202,{ok:true});}
      if(req.method==='GET'&&pathname==='/web-library/manifest.json')return json(res,200,library.manifest(url));
      if(['GET','HEAD'].includes(req.method)&&pathname.startsWith('/web-library/files/')){const result=await library.raw(pathname.slice('/web-library/files/'.length));res.writeHead(200,{'content-type':result.type,'content-length':result.bytes.length,'cache-control':'no-store'});return res.end(req.method==='HEAD'?undefined:result.bytes);}
      if(req.method==='GET'&&pathname==='/api/database-manifest'){
        const collection=library.catalog?.byCollection.get(url.searchParams.get('hostedPath'));if(!collection)return json(res,404,{error:'Shared database was removed'});
        return json(res,200,{version:1,maxPly:1000,gameCount:collection.gameCount,positionCount:0,latestDate:null,shards:[]});
      }
      if(req.method==='GET'&&pathname==='/api/database-position')return json(res,200,library.position(url.searchParams.get('hostedPath'),String(url.searchParams.get('fen')??'').trim().split(/\s+/).slice(0,4).join(' ')));
      if(req.method==='GET'&&pathname==='/api/personal-sync/game')return json(res,200,await library.game(url.searchParams.get('ref')));
      if(req.method==='PUT'&&['/api/personal-sync/game','/api/personal-sync/import'].includes(pathname)){
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{error:'JSON is required'});
        let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>64*1024*1024)return json(res,413,{error:'Phone import exceeds 64 MB; split it into smaller PGN files'});chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return phoneWrite(async()=>{const saved=pathname.endsWith('/import')?await library.importDatabase(body):await library.save(body);json(res,200,saved);});
      }
      return json(res,404,{error:'Unknown personal sync route'});
    })().catch(e=>{if(!res.headersSent)json(res,e.status??400,{error:e.message});else res.destroy();});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.port,'127.0.0.1',resolve);});
  await tick();
  const timer=setInterval(()=>{if(!closed)void tick();},20_000);
  const close=async()=>{if(closed)return;closed=true;clearInterval(timer);server.close();await Promise.all([queue,phoneQueue]);bridge.close();codec.close();native.close();const lock=JSON.parse(await fs.readFile(lockPath,'utf8'));if(lock.nonce===nonce)await fs.unlink(lockPath);};
  return{server,close,tick};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const runner=await startRunner(config);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void runner.close().then(()=>process.exit(0));});
}
