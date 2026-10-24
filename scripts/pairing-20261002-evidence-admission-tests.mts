/** Actual-source admissions with solver/Worker doubles only. No real solver,
 * browser, model worker, outcome corpus or frozen experiment is imported. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,extname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),DIR=resolve(ROOT,'src/features/tournaments');
const outIndex=process.argv.indexOf('--out');assert(outIndex>=0&&process.argv[outIndex+1],'An exclusive external --out receipt is required');
const output=resolve(process.argv[outIndex+1]);assert(!existsSync(output),'Refuse overwriting a receipt');
const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const plain=(v:any)=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const sourceBefore:Record<string,string>={};
function boundRead(path:string){const raw=readFileSync(path),digest=sha(raw);if(sourceBefore[path])assert.equal(sourceBefore[path],digest,'Source changed while loading');else sourceBefore[path]=digest;return raw;}
boundRead(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const transpilerRootIndex=process.argv.indexOf('--typescript-root');
if(transpilerRootIndex>=0)assert(process.argv[transpilerRootIndex+1],'--typescript-root needs an explicit existing dependency root');
const resolutionRoot=transpilerRootIndex>=0?resolve(process.argv[transpilerRootIndex+1]):ROOT;
const transpilerRequire=transpilerRootIndex>=0?createRequire(resolve(resolutionRoot,'package.json')):require;
const ts=transpilerRequire('typescript');
const transpiler={version:ts.version,resolutionRoot,packagePath:transpilerRequire.resolve('typescript/package.json'),runtimePath:transpilerRequire.resolve('typescript')};
boundRead(transpiler.packagePath);boundRead(transpiler.runtimePath);
const solverCalls:any[]=[],workerMessages:any[]=[],fieldCalls:any[]=[];
let workerConstructions=0,workerTerminations=0,checks=0;
function solverDouble(players:any[],rounds:any[],options:any){
 solverCalls.push(plain({players,rounds,options}));
 const games=[],byes=[];const half=Math.ceil(players.length/2);
 for(let i=0;i<Math.floor(players.length/2);i++)games.push({white:players[i].id,black:players[i+half].id});
 if(players.length%2)byes.push({player:players[half-1].id,kind:'pairing'});
 return {games,byes};
}
class FakeWorker{
 listeners:Record<string,Function>={};
 constructor(){workerConstructions++;}
 addEventListener(name:string,fn:Function){this.listeners[name]=fn;}
 postMessage(value:any){workerMessages.push(plain(value));queueMicrotask(()=>this.listeners.message({data:{id:value.id,
   forecasts:Object.fromEntries(value.snapshot.players.map((p:any)=>[p.startNumber,{opponentStartNumber:p.startNumber===1?3:1,
    color:'white',estimatedLiveResults:false,system:'dutch',acceleration:null}]))}}));}
 terminate(){workerTerminations++;}
}
function loader(overrides:Record<string,any>={},globals:Record<string,any>={}){
 const cache=new Map<string,any>();
 function load(name:string,from=DIR):any{
  if(name==='react')return new Proxy({},{get:()=>()=>{throw new Error('React render forbidden in pure admission harness');}});
  if(/^@echecs\/swiss\/(dutch|burstein|dubov|lim)$/.test(name))return {pair:solverDouble};
  assert(name.startsWith('.')||name.startsWith(DIR),'Undeclared external runtime import: '+name);
  let path=resolve(from,name);if(!extname(path))path+='.ts';
  assert(path.startsWith(DIR+'/')||path.startsWith(DIR+'\\'),'Import escaped tournament pure-source boundary');
  const short=relative(DIR,path).replaceAll('\\','/');
  if(Object.hasOwn(overrides,short))return overrides[short];
  if(cache.has(path))return cache.get(path).exports;
  const raw=boundRead(path).toString('utf8');
  if(path.endsWith('.json')){const result=JSON.parse(raw);cache.set(path,{exports:result});return result;}
  const module={exports:{} as any};cache.set(path,module);
  const exposed=short==='usePairingForecast.ts'?raw+'\nexport { shouldCalculateExact };':
   short==='pairingForecast.ts'?raw+'\nexport { projectedPoints };':raw;
  const transpiled=ts.transpileModule(exposed.replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path).href)),
   {fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},reportDiagnostics:true});
  assert(!(transpiled.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error),'Transpile failed: '+short);
  vm.runInNewContext(transpiled.outputText,{module,exports:module.exports,require:(id:string)=>load(id,dirname(path)),
   URL,AbortController,setTimeout,clearTimeout,queueMicrotask,structuredClone,performance,Worker:FakeWorker,...globals},{filename:path});
  return module.exports;
 }
 return (name:string)=>load('./'+name);
}
const eq=(a:any,b:any,message?:string)=>{checks++;assert.deepEqual(plain(a),plain(b),message);};
const ok=(v:any,message?:string)=>{checks++;assert(v,message);};
const groups:any[]=[],failures:any[]=[];
const test=async(name:string,fn:()=>any)=>{const before=checks;try{await fn();groups.push({name,status:'passed',assertions:checks-before});}
 catch(error){const failure={name,status:'failed',assertions:checks-before,error:error instanceof Error?error.stack:String(error)};groups.push(failure);failures.push(failure);}};
function fixture():any{return {tournamentId:'admission-synthetic',sourceUrl:'fixture://admission',title:'Invented admission',section:null,
 format:'swiss',formatLabel:'Swiss-System',totalRounds:3,completedRound:1,publishedRound:1,nextRound:2,liveRound:null,phase:'between-rounds',
 dateRange:null,timeControl:null,fetchedAt:'synthetic',sourceUpdatedAt:null,warnings:[],roundStandings:[],incompletePairingRounds:[],
 players:[1,2,3,4].map(startNumber=>({startNumber,name:`P${startNumber}`,rating:2200-startNumber*100,points:0,rank:null,
  fideId:null,federation:null,title:null,active:true,notPairedRounds:[],halfPointByeRounds:[]})),
 pairings:[{round:1,board:1,whiteStartNumber:1,blackStartNumber:2,whitePoints:null,blackPoints:null,result:'1-0',decided:true},
  {round:1,board:2,whiteStartNumber:3,blackStartNumber:4,whitePoints:null,blackPoints:null,result:'½-½',decided:true}]};}
const stale={opponentStartNumber:4,color:'black',estimatedLiveResults:false,system:'dutch',acceleration:null};
const started=performance.now();
let app:any,evidence:any,forecast:any,exact:any,sampled:any,client:any,hook:any,handler:Function|undefined;const posts:any[]=[];
await test('actual TS module graph loads with only declared pure imports and doubles',()=>{
 app=loader();evidence=app('tournamentForecastEvidence.ts');forecast=app('pairingForecast.ts');exact=app('exactSwissForecast.ts');
 sampled=app('sampledSwissForecast.ts');client=app('exactSwissForecastClient.ts');hook=app('usePairingForecast.ts');
 loader({'sampledSwissForecast.ts':{calculateSampledSwissForecast:(s:any,r:number,p:number)=>{fieldCalls.push({round:r,player:p});return null;}}},
  {self:{addEventListener:(_:string,fn:Function)=>{handler=fn;},postMessage:(v:any)=>posts.push(plain(v))}})('exactSwissForecast.worker.ts');
 ok(handler);eq(solverCalls.length,0);eq(workerConstructions,0);
});
const noNumbers=(s:any)=>{
 const none=forecast.calculatePairingForecast(s,1,{exactSwiss:null}),old=forecast.calculatePairingForecast(s,1,{exactSwiss:stale});
 eq(old,none,'Stale exact output overrode evidence refusal');
 ok(none.candidates.length>0);ok(none.candidates.every((c:any)=>c.probability===null));eq(none.otherProbability,null);
 return none;
};
const declines=async(s:any)=>{
 const n=solverCalls.length,w=workerConstructions,f=fieldCalls.length;
 eq(exact.calculateExactSwissForecast(s,s.nextRound,1),null);eq(sampled.calculateSampledSwissForecast(s,s.nextRound,1),null);
 eq(await client.requestExactSwissForecast(s,s.nextRound,1),null);eq(hook.shouldCalculateExact(s,1),false);
 handler!({data:{id:42,snapshot:s,targetRound:s.nextRound,system:'dutch'}});eq(posts.at(-1),{id:42,forecasts:{}});
 eq(solverCalls.length,n);eq(workerConstructions,w);eq(fieldCalls.length,f);
};
await test('legacy complete history recovers scores and positive exact/sample controls reach solver doubles',()=>{
 const s=fixture(),before=JSON.stringify(s),prepared=evidence.prepareTournamentForecastEvidence(s,2);
 eq(prepared.issue,null);eq(prepared.snapshot.players.map((p:any)=>p.points),[1,0,.5,.5]);
 ok(prepared.snapshot.players.every((p:any)=>p.scoreKnown));eq(JSON.stringify(s),before);
 let count=solverCalls.length;ok(exact.calculateExactSwissForecast(structuredClone(s),2,1));ok(solverCalls.length>count);
 eq(solverCalls.at(-1).players.map((p:any)=>p.points),[1,0,.5,.5]);
 count=solverCalls.length;ok(sampled.calculateSampledSwissForecast(structuredClone(s),2,1));ok(solverCalls.length>count);
 const f=forecast.calculatePairingForecast(s,1,{exactSwiss:null});ok(f.candidates.some((c:any)=>c.probability!==null));
});
await test('missing prior assignment nulls probabilities and blocks every numerical admission',async()=>{
 const s=fixture();s.pairings=s.pairings.slice(0,1);eq(evidence.prepareTournamentForecastEvidence(s,2).issue,'incomplete-history');
 noNumbers(s);await declines(s);
});
await test('authoritative adjusted totals remain real while all history-only solver paths decline',async()=>{
 const s=fixture();s.evidenceVersion=1;
 s.players.forEach((p:any,i:number)=>Object.assign(p,{points:[2,0,.5,.5][i],scoreKnown:true,scoreRound:1,scoreSource:'published'}));
 const prepared=evidence.prepareTournamentForecastEvidence(s,2);eq(prepared.issue,'adjusted-score');eq(prepared.snapshot.players[0].points,2);
 eq(prepared.snapshot.players[0].scoreKnown,true);noNumbers(s);await declines(s);
});
await test('old unknown results decline; immediate pending named game keeps assignment and permits solver admission',async()=>{
 const old=fixture();old.pairings[0].result='adjourned';old.pairings[0].decided=false;
 eq(evidence.prepareTournamentForecastEvidence(old,2).issue,'unknown-results');noNumbers(old);await declines(old);
 const live=fixture();live.completedRound=0;live.liveRound=1;live.phase='round-in-progress';live.pairings[0].result=null;live.pairings[0].decided=false;
 const p=evidence.prepareTournamentForecastEvidence(live,2);eq(p.issue,null);
 eq([p.evidence.players[0].rounds[0].opponentStartNumber,p.evidence.players[0].rounds[0].color,p.evidence.players[0].rounds[0].result],[2,'white','live-pending']);
 let n=solverCalls.length;ok(exact.calculateExactSwissForecast(live,2,1));ok(solverCalls.length>n);
 const f=forecast.calculatePairingForecast(live,1,{exactSwiss:null});ok(f.candidates.every((c:any)=>c.player.startNumber!==2));
});
await test('versioned no-game awards are strict; legacy availability flags are unverified',async()=>{
 const s=fixture();s.evidenceVersion=1;s.pairings=s.pairings.slice(0,1);
 s.roundStatus=[{round:1,startNumber:3,kind:'not-paired',award:.5},{round:1,startNumber:4,kind:'not-yet-entered',award:0}];
 eq(evidence.prepareTournamentForecastEvidence(s,2).issue,null);eq(evidence.prepareTournamentForecastEvidence(s,2).snapshot.players.map((p:any)=>p.points),[1,0,.5,0]);
 const missing=structuredClone(s);missing.roundStatus[0].award=null;noNumbers(missing);await declines(missing);
 const legacy=fixture();legacy.players[2].active=false;eq(evidence.prepareTournamentForecastEvidence(legacy,2).issue,'unknown-availability');noNumbers(legacy);await declines(legacy);
 const own=fixture();own.players[0].notPairedRounds=[2];eq(forecast.calculatePairingForecast(own,1,{exactSwiss:stale}).kind,'unavailable');
 const explicit=fixture();explicit.evidenceVersion=1;explicit.roundStatus=[{round:2,startNumber:1,kind:'not-paired',award:null}];
 eq(evidence.prepareTournamentForecastEvidence(explicit,2).snapshot.players[0].active,false);
 eq(forecast.calculatePairingForecast(explicit,1,{exactSwiss:stale}).kind,'scheduled');
});
await test('versioned compatible status awards complete unknown solo rows exactly once in historical and live solver history',()=>{
 for(const live of [false,true])for(const soloResult of [null,'½'])for(const black of [false,true]){
  const s=fixture();s.evidenceVersion=1;
  s.pairings=[{...s.pairings[0],whiteStartNumber:black?null:1,blackStartNumber:black?1:null,result:soloResult,decided:soloResult!==null},
   {...s.pairings[0],board:2,whiteStartNumber:null,blackStartNumber:2,result:'1',decided:true},s.pairings[1]];
  s.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:.5}];
  if(live){s.liveRound=1;s.completedRound=0;s.phase='round-in-progress';}
  eq(evidence.prepareTournamentForecastEvidence(s,2).issue,null);
  const n=solverCalls.length;ok(exact.calculateExactSwissForecast(s,2,1));ok(solverCalls.length>n);
  const ownByes=solverCalls.at(-1).rounds[0].byes.filter((b:any)=>b.player==='1');
  eq(ownByes,[{player:'1',kind:'half'}],'Coalesced source award missing or counted twice');
  ok(sampled.calculateSampledSwissForecast(structuredClone(s),2,1));
 }
});
await test('live coalesced half award is one deterministic heuristic score outcome for either occupied seat',()=>{
 for(const black of [false,true])for(const soloResult of [null,'½']){
  const s=fixture();Object.assign(s,{evidenceVersion:1,completedRound:0,liveRound:1,phase:'round-in-progress'});
  s.pairings=[{...s.pairings[0],whiteStartNumber:black?null:1,blackStartNumber:black?1:null,result:soloResult,decided:soloResult!==null},
   {...s.pairings[0],board:2,whiteStartNumber:null,blackStartNumber:2,result:'1',decided:true},s.pairings[1]];
  s.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:.5}];
  const prepared=evidence.prepareTournamentForecastEvidence(s,2).snapshot;
  eq(prepared.players[0].points,0);
  eq(forecast.projectedPoints(prepared,1,2,new Map(prepared.players.map((p:any)=>[p.startNumber,p]))),[{points:.5,weight:1}]);
 }
});
await test('unreadable solo row without a scored status stays unknown in historical and live states',async()=>{
 for(const live of [false,true]){
  const s=fixture();s.evidenceVersion=1;s.pairings=[{...s.pairings[0],blackStartNumber:null,result:null,decided:false},
   {...s.pairings[0],board:2,whiteStartNumber:null,blackStartNumber:2,result:'1',decided:true},s.pairings[1]];
  s.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:null}];
  if(live){s.liveRound=1;s.completedRound=0;s.phase='round-in-progress';}
  eq(evidence.prepareTournamentForecastEvidence(s,2).issue,'unknown-results');noNumbers(s);await declines(s);
 }
});
await test('duplicate and invalid target statuses refuse numerics while an unrelated unique published assignment stays confirmed',async()=>{
 for(const statuses of [
  [{round:2,startNumber:3,kind:'not-paired',award:0},{round:2,startNumber:3,kind:'not-paired',award:0}],
  [{round:2,startNumber:3,kind:'not-paired',award:2}],
 ]){
  const s=fixture();s.evidenceVersion=1;s.roundStatus=statuses;
  const published=structuredClone(s);published.pairings.push({...published.pairings[0],round:2,result:null,decided:false});
  const confirmed=forecast.calculatePairingForecast(published,1,{exactSwiss:stale});eq(confirmed.kind,'confirmed');eq(confirmed.candidates[0].player.startNumber,2);
  const prepared=evidence.prepareTournamentForecastEvidence(s,2);eq(prepared.numericalAvailable,false);eq(prepared.solverCompatible,false);
  noNumbers(s);await declines(s);
 }
});
await test('version-one raw legacy availability flags cannot suppress hook admission',()=>{
 const s=fixture();s.evidenceVersion=1;s.players[0].active=false;s.players[0].notPairedRounds=[2];s.players[0].halfPointByeRounds=[2];
 eq(evidence.prepareTournamentForecastEvidence(s,2).snapshot.players[0].active,true);eq(hook.shouldCalculateExact(s,1),true);
});
await test('version-one raw legacy availability flags cannot suppress assumed RR opponent',()=>{
 const rr=fixture();Object.assign(rr,{evidenceVersion:1,format:'round-robin',formatLabel:'Round robin',completedRound:0,publishedRound:0,nextRound:1,pairings:[]});
 const clean=forecast.calculatePairingForecast(rr,1,{exactSwiss:null});eq(clean.kind,'inferred');
 const flagged=structuredClone(rr),opponent=clean.candidates[0].player.startNumber;
 flagged.players.find((p:any)=>p.startNumber===opponent).active=false;
 flagged.players.find((p:any)=>p.startNumber===opponent).notPairedRounds=[1];
 const actual=forecast.calculatePairingForecast(flagged,1,{exactSwiss:null});eq(actual.kind,'inferred');eq(actual.candidates[0].player.startNumber,opponent);
});
await test('record-budget refusal precedes resolver allocation and all downstream solver/worker work',async()=>{
 let resolverCalls=0;const guarded=loader({'tournamentSnapshotEvidence.ts':{resolveTournamentSnapshotEvidence:()=>{resolverCalls++;throw new Error('Resolver allocation forbidden');}}});
 const admission=guarded('tournamentForecastEvidence.ts'),s=fixture();s.totalRounds=0;s.nextRound=2**32;s.completedRound=0;s.pairings=[];
 eq(admission.cachedTournamentEvidence(s,s.nextRound),null);eq(admission.prepareTournamentForecastEvidence(s,s.nextRound).issue,'invalid-evidence');eq(resolverCalls,0);
 noNumbers(s);await declines(s);
});
await test('published v1 target assignment retains precedence despite missing past and adjusted totals',()=>{
 const s=fixture();s.evidenceVersion=1;s.pairings=[{...s.pairings[0],round:2,result:null,decided:false}];
 s.players[0].points=99;s.players[0].scoreKnown=true;s.players[0].scoreRound=1;s.players[0].scoreSource='published';
 const f=forecast.calculatePairingForecast(s,1,{exactSwiss:stale});eq(f.kind,'confirmed');eq(f.candidates[0].player.startNumber,2);eq(f.candidates[0].probability,1);
});
await test('client and actual whole-field handler positive controls reach explicit doubles',async()=>{
 const s=fixture(),w=workerConstructions,f=fieldCalls.length;ok(hook.shouldCalculateExact(s,1));
 ok(await client.requestExactSwissForecast(s,2,1));eq(workerConstructions,w+1);ok(workerTerminations>=1);
 handler!({data:{id:9,snapshot:s,targetRound:2,system:'dutch'}});eq(fieldCalls.length,f+4);eq(Object.keys(posts.at(-1).forecasts).length,4);
});
await test('cache identity includes evidence metadata but excludes observation timestamps',async()=>{
 const s=fixture(),key=client.exactSwissForecastKey(s,2,1);
 const changed=structuredClone(s);changed.evidenceVersion=1;changed.players[0].scoreKnown=false;changed.players[0].scoreRound=null;changed.players[0].scoreSource='unknown';
 ok(client.exactSwissForecastKey(changed,2,1)!==key);
 const status=structuredClone(s);status.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:0}];ok(client.exactSwissForecastKey(status,2,1)!==key);
 const timestamps={...s,fetchedAt:'later',sourceUpdatedAt:'later'};eq(client.exactSwissForecastKey(timestamps,2,4),key);
 const w=workerConstructions;ok(await client.requestExactSwissForecast(timestamps,2,1));eq(workerConstructions,w);
 ok(await client.requestExactSwissForecast(changed,2,1));eq(workerConstructions,w+1);
});
await test('serialized prepared snapshots retain every refusal issue and cannot launder source evidence',async()=>{
 const cases:Array<{name:string;issue:string;edit:(s:any)=>void}>=[
  {name:'record-budget',issue:'invalid-evidence',edit:s=>Object.assign(s,{totalRounds:0,nextRound:2**32,completedRound:0,pairings:[]})},
  {name:'duplicate-target-status',issue:'conflicting-target',edit:s=>Object.assign(s,{evidenceVersion:1,roundStatus:[
   {round:2,startNumber:3,kind:'not-paired',award:0},{round:2,startNumber:3,kind:'not-paired',award:0}]})},
  {name:'missing-history',issue:'incomplete-history',edit:s=>{s.pairings=s.pairings.slice(0,1);}},
  {name:'unknown-result',issue:'unknown-results',edit:s=>{s.pairings[0].result='adjourned';s.pairings[0].decided=false;}},
  {name:'invalid-score-source',issue:'unknown-scores',edit:s=>{s.evidenceVersion=1;Object.assign(s.players[0],{scoreKnown:true,scoreRound:1,scoreSource:'invalid'});}},
  {name:'invalid-score-scope',issue:'unknown-scores',edit:s=>{s.evidenceVersion=1;Object.assign(s.players[0],{scoreKnown:true,scoreRound:null,scoreSource:'published'});}},
  {name:'adjusted-score',issue:'adjusted-score',edit:s=>{s.evidenceVersion=1;Object.assign(s.players[0],{points:2,scoreKnown:true,scoreRound:1,scoreSource:'published'});}},
  {name:'legacy-inactive',issue:'unknown-availability',edit:s=>{s.players[2].active=false;}},
  {name:'legacy-not-paired',issue:'unknown-availability',edit:s=>{s.players[2].notPairedRounds=[2];}},
  {name:'legacy-half-bye-only',issue:'unknown-availability',edit:s=>{s.players[2].halfPointByeRounds=[2];}},
 ];
 for(const c of cases){
  const s=fixture();s.tournamentId+='-'+c.name;c.edit(s);const original=JSON.stringify(s);
  const prepared=evidence.prepareTournamentForecastEvidence(s,s.nextRound);eq(prepared.issue,c.issue,c.name);
  for(const clone of [structuredClone(prepared.snapshot),JSON.parse(JSON.stringify(prepared.snapshot))]){
   const again=evidence.prepareTournamentForecastEvidence(clone,clone.nextRound);
   eq(again.issue,c.issue,c.name+' serialized refusal');eq(again.numericalAvailable,false);eq(again.solverCompatible,false);
   noNumbers(clone);await declines(clone);
   eq(evidence.prepareTournamentForecastEvidence(structuredClone(again.snapshot),clone.nextRound).issue,c.issue,c.name+' repeated clone');
  }
  eq(JSON.stringify(s),original,c.name+' source mutation');
 }
});
await test('eligible prepared clones retain recovered scores and reach solver and client doubles',async()=>{
 for(const kind of ['legacy-complete','versioned-complete','versioned-published','immediate-live','versioned-ignored-hints']){
  const s=fixture();s.tournamentId+='-positive-clone-'+kind;
  if(kind.startsWith('versioned'))s.evidenceVersion=1;
  if(kind==='versioned-published')s.players.forEach((p:any,i:number)=>Object.assign(p,{points:[1,0,.5,.5][i],scoreKnown:true,scoreRound:1,scoreSource:'published'}));
  if(kind==='immediate-live'){Object.assign(s,{evidenceVersion:1,completedRound:0,liveRound:1,phase:'round-in-progress'});s.pairings[0].result=null;s.pairings[0].decided=false;}
  if(kind==='versioned-ignored-hints')Object.assign(s.players[0],{active:false,notPairedRounds:[2],halfPointByeRounds:[2]});
  const prepared=evidence.prepareTournamentForecastEvidence(s,2);eq(prepared.issue,null,kind);
  for(const clone of [structuredClone(prepared.snapshot),JSON.parse(JSON.stringify(prepared.snapshot))]){
   const again=evidence.prepareTournamentForecastEvidence(clone,2);eq(again.issue,null,kind+' serialized eligibility');
   eq(again.snapshot.players.map((p:any)=>p.points),prepared.snapshot.players.map((p:any)=>p.points));
   // A serialized reconstructed total can become a newer derived anchor;
   // compare its meaning, not the resolver's internal basis-round choice.
   const meaning=(value:any)=>value.players.map((p:any)=>({startNumber:p.startNumber,rounds:p.rounds,target:p.target,
    points:p.aggregate.points,scoreKnown:p.aggregate.scoreKnown,throughRound:p.aggregate.throughRound}));
   eq(meaning(again.evidence),meaning(prepared.evidence),kind+' evidence meaning');
   eq(forecast.calculatePairingForecast(clone,1,{exactSwiss:null}),forecast.calculatePairingForecast(prepared.snapshot,1,{exactSwiss:null}));
   let n=solverCalls.length;ok(exact.calculateExactSwissForecast(clone,2,1));ok(solverCalls.length>n);
   n=solverCalls.length;ok(sampled.calculateSampledSwissForecast(structuredClone(clone),2,1));ok(solverCalls.length>n);
   eq(hook.shouldCalculateExact(clone,1),true);ok(await client.requestExactSwissForecast(clone,2,1));
  }
 }
});
await test('helper alone fails closed on absent or null roster records without projecting malformed input',()=>{
 for(const kind of ['absent-players','null-player']){
  const s=fixture();if(kind==='absent-players')delete s.players;else s.players[0]=null;
  const original=JSON.stringify(s),n=solverCalls.length,w=workerConstructions;
  const prepared=evidence.prepareTournamentForecastEvidence(s,2);
  eq(prepared.issue,'invalid-evidence');eq(prepared.numericalAvailable,false);eq(prepared.solverCompatible,false);
  ok(prepared.snapshot===s,'Malformed source must be returned unchanged');eq(JSON.stringify(s),original);
  eq(solverCalls.length,n);eq(workerConstructions,w);
 }
});
await test('live conditional projection preserves a published quarter-point adjustment plus explicit half award',()=>{
 const s=fixture();Object.assign(s,{evidenceVersion:1,completedRound:0,liveRound:1,phase:'round-in-progress'});
 Object.assign(s.players[0],{points:.25,scoreKnown:true,scoreRound:0,scoreSource:'published'});
 s.pairings=[{...s.pairings[0],blackStartNumber:null,result:null,decided:false},
  {...s.pairings[0],board:2,whiteStartNumber:null,blackStartNumber:2,result:'1',decided:true},s.pairings[1]];
 s.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:.5}];
 const prepared=evidence.prepareTournamentForecastEvidence(s,2);eq(prepared.issue,'adjusted-score');eq(prepared.snapshot.players[0].points,.25);
 eq(forecast.projectedPoints(prepared.snapshot,1,2,new Map(prepared.snapshot.players.map((p:any)=>[p.startNumber,p]))),[{points:.75,weight:1}]);
});
await test('live named conditional outcomes preserve exact JavaScript base-plus-award without forcing a half-point grid',()=>{
 const s=fixture();Object.assign(s,{evidenceVersion:1,completedRound:0,liveRound:1,phase:'round-in-progress'});
 Object.assign(s.players[0],{points:.1,scoreKnown:true,scoreRound:0,scoreSource:'published'});
 s.pairings[0].result=null;s.pairings[0].decided=false;
 const prepared=evidence.prepareTournamentForecastEvidence(s,2);eq(prepared.issue,'adjusted-score');
 const actual=forecast.projectedPoints(prepared.snapshot,1,2,new Map(prepared.snapshot.players.map((p:any)=>[p.startNumber,p])));
 eq(actual.map((row:any)=>row.points),[.1+1,.1+.5,.1+0]);
 ok(actual.every((row:any)=>row.weight>0));ok(Math.abs(actual.reduce((sum:number,row:any)=>sum+row.weight,0)-1)<1e-12);
});
await test('all loaded source and transpiler bytes stayed unchanged',()=>{for(const [path,digest]of Object.entries(sourceBefore))eq(sha(readFileSync(path)),digest,path);});
const result={schema:'evidence-admission-actual-source-v1',passed:failures.length===0,groups,assertions:checks,failures,
 elapsedMs:performance.now()-started,node:process.version,transpiler,sourceBefore,
 sourceAfter:Object.fromEntries(Object.keys(sourceBefore).map(path=>[path,sha(readFileSync(path))])),
 doubles:{solverCalls:solverCalls.length,workerConstructions,workerTerminations,wholeFieldCalls:fieldCalls.length},
 limits:'Actual source admissions/heuristic fallback with explicit solver and Worker doubles. No real solver, worker, native, browser, full-type or corpus execution.'};
writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,groups:groups.length,assertions:checks,failures,elapsedMs:result.elapsedMs,doubles:result.doubles,receipt:output,receiptSHA256:sha(readFileSync(output))},null,2));
if(!result.passed)process.exitCode=1;
