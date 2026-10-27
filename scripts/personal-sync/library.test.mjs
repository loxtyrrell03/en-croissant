import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parsePgn,makePgn} from 'chessops/pgn';
import {PersonalLibrary,portablePgn,stampPgn,readReference} from './library.mjs';
import {DatabaseSyncBridge} from './databases.mjs';
import {JsonLineProcess} from './rpc.mjs';

const pgn=comment=>`[Event "Fixture"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n[Custom "keep"]\n\n{${comment}} 1. e4 (1. d4 d5) e5 *`;
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'personal-phone-test-'));const dev=path.join(root,'app.outpost.chess.dev');fs.mkdirSync(dev);const library=path.join(dev,'library.sqlite');fs.writeFileSync(library,'');
 const codec=new JsonLineProcess(path.resolve('src-tauri/target/debug/personal-chess-sync-codec.exe')),native=new JsonLineProcess(path.resolve('../outpost-chess/src-tauri/target/debug/novelty-dev-personal-sync.exe'));
 const id=(await native.request({library,collection:1,pgn:pgn('original')})).id;
 const bridge=new DatabaseSyncBridge({library,enRoot:path.join(root,'en'),ledger:path.join(root,'ledger.sqlite'),codec,native});await bridge.initialize();
 const filesRoot=path.join(root,'files');fs.mkdirSync(filesRoot);fs.mkdirSync(path.join(filesRoot,'Empty'));fs.writeFileSync(path.join(filesRoot,'Games.pgn'),pgn('one')+'\n\n'+pgn('two'));
 const phone=new PersonalLibrary({bridge,filesRoot,recoveryRoot:path.join(root,'recovery')});await phone.refresh();
 t.after(()=>{bridge.close();codec.close();native.close();fs.rmSync(root,{recursive:true,force:true});});return{phone,bridge,root,filesRoot,id};
}
test('phone metadata retains comments, variations and private headers without persisting transport tags',()=>{
 const original=pgn('note');const stamped=stampPgn(original,'database:1:2','a'.repeat(64));assert.equal(portablePgn(stamped),portablePgn(original));assert.deepEqual(readReference('database:1:2'),{kind:'database',collection:1,game:2,scope:'database:1:2'});assert.throws(()=>readReference('../production'),/linked/);
});
test('the phone catalogue exposes Dev content and empty folders, with stable database and game identities',async t=>{
 const f=await fixture(t),manifest=f.phone.manifest(new URL('http://local/web-library/manifest.json'));
 assert.equal(manifest.databases.length,1);assert.equal(manifest.databases[0].gameCount,1);
 const listing=f.phone.manifest(new URL('http://local/web-library/manifest.json?scope=directory'));assert(listing.entries.some(e=>e.path==='Empty'));
 const exported=await f.phone.raw(manifest.databases[0].path+'/games.pgn');assert.match(exported.bytes.toString(),/PersonalSyncRef "database:1:1"/);
});

test('existing phone static manifest URLs resolve the same live collection as the API',async t=>{
 const f=await fixture(t),manifest=f.phone.manifest(new URL('http://local/web-library/manifest.json'));
 const hosted=manifest.databases[0].path;
 for(const prefix of ['',`__personal/${f.phone.id}/`]){
  const raw=await f.phone.raw(prefix+hosted+'/position-index/index.json');
  assert.match(raw.type,/application\/json/);assert.deepEqual(JSON.parse(raw.bytes),f.phone.databaseManifest(hosted));
  assert.equal(JSON.parse(raw.bytes).gameCount,1);
 }
 await assert.rejects(f.phone.raw('Empty/position-index/index.json'),{status:404});
 await assert.rejects(f.phone.raw(hosted+'/position-index/shards/00.json'),{status:404});
 await assert.rejects(f.phone.raw('Databases/Desktop/Unknown/position-index/index.json'),{status:404});
 assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM game_record').get().n,1);
});

test('rejected phone PGNs retain one local diagnostic and never overwrite the saved game',async t=>{
 const f=await fixture(t),before=await f.phone.game(`database:1:${f.id}`);
 const rejected=before.pgn.replace('1. e4','1. b1');
 await assert.rejects(f.phone.save({...before,pgn:rejected}),/Cannot faithfully encode b1/);
 const file=path.join(f.root,'recovery','last-rejected-pgn.json'),saved=fs.readFileSync(file,'utf8');
 assert.equal(JSON.parse(saved).ref,before.ref);assert.equal(JSON.parse(saved).pgn,portablePgn(rejected));
 await assert.rejects(f.phone.save({...before,pgn:rejected}),/Cannot faithfully encode b1/);
 assert.equal(fs.readFileSync(file,'utf8'),saved);
 assert.equal((await f.phone.game(before.ref)).pgn,before.pgn);
});

test('live position lookup retains exact collection scope, result totals, dates and fresh updates',async t=>{
 const f=await fixture(t),db=f.bridge.source;
 const game=(event,result,date,moves)=>`[Event "${event}"]\n[Date "${date}"]\n[Result "${result}"]\n\n${moves} ${result}`;
 const one=await f.bridge.native.request({library:f.bridge.library,collection:1,pgn:game('Win','1-0','2026.10.10','1. e4 c5')});
 await f.bridge.native.request({library:f.bridge.library,collection:1,pgn:game('Draw','1/2-1/2','2026.10.11','1. d4 d5')});
 const other=Number(db.prepare("INSERT INTO collection(name,folder) VALUES('Other','')").run().lastInsertRowid);
 await f.bridge.native.request({library:f.bridge.library,collection:other,pgn:game('Excluded','0-1','2026.10.27','1. e4 e5')});
 const hosted=f.phone.manifest(new URL('http://local')).databases[0].path;
 const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
 assert.deepEqual(f.phone.position(hosted,fen).find(r=>r.move==='e4'),{move:'e4',white:1,draw:0,black:0,lastPlayed:'2026.10.10',uci:null});
 assert.deepEqual(f.phone.position(hosted,fen).find(r=>r.move==='d4'),{move:'d4',white:0,draw:1,black:0,lastPlayed:'2026.10.11',uci:null});
 const current=db.prepare('SELECT pgn FROM game_record WHERE id=?').get(one.id).pgn;
 await f.bridge.native.request({library:f.bridge.library,id:one.id,expected:current,pgn:game('Win','0-1','2026.10.12','1. e4 c5')});
 assert.deepEqual(f.phone.position(hosted,fen).find(r=>r.move==='e4'),{move:'e4',white:0,draw:0,black:1,lastPlayed:'2026.10.12',uci:null});
 assert.deepEqual(f.phone.position(hosted,'8/8/8/8/8/8/8/K6k w - -'),[]);
});
test('phone game saves use compare-and-swap and update native search indexes without losing unknown tags',async t=>{
 const f=await fixture(t),ref=`database:1:${f.id}`,before=await f.phone.game(ref);
 const saved=await f.phone.save({ref,revision:before.revision,pgn:before.pgn.replace('original','phone edit')});assert.notEqual(saved.revision,before.revision);
 const row=f.bridge.source.prepare('SELECT pgn FROM game_record WHERE id=?').get(f.id);assert.match(row.pgn,/phone edit/);assert.match(row.pgn,/Custom "keep"/);assert.doesNotMatch(row.pgn,/PersonalSync/);
 await assert.rejects(f.phone.save({ref,revision:before.revision,pgn:before.pgn.replace('original','stale')}),/changed on the PC/);
 assert(f.bridge.source.prepare('SELECT count(*) n FROM position_hit WHERE game_id=?').get(f.id).n>0);
});
test('separate games in one PGN can be saved independently, retaining concurrent edits to other games',async t=>{
 const f=await fixture(t),one=await f.phone.game('file:Games.pgn:0'),two=await f.phone.game('file:Games.pgn:1');
 await f.phone.save({ref:one.ref,revision:one.revision,pgn:one.pgn.replace('{ one }','{ edited one }')});
 await f.phone.save({ref:two.ref,revision:two.revision,pgn:two.pgn.replace('{ two }','{ edited two }')});
 const raw=fs.readFileSync(path.join(f.filesRoot,'Games.pgn'),'utf8');assert.match(raw,/edited one/);assert.match(raw,/edited two/);assert.doesNotMatch(raw,/PersonalSync/);
 await assert.rejects(f.phone.save({ref:one.ref,revision:one.revision,pgn:one.pgn}),/changed on the PC/);
 await assert.rejects(f.phone.game('file:../outside.pgn:0'),/Invalid/);
});
test('phone database imports are validated first and repeated requests recover the same collection and game IDs',async t=>{
 const f=await fixture(t),body={clientId:'phone-new',name:'New collection',pgn:pgn('new').replace('Fixture','Another event')};
 const first=await f.phone.importDatabase(body),again=await f.phone.importDatabase(body);assert.equal(first.collection,again.collection);assert.equal(first.games[0].ref,again.games[0].ref);
 assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM collection').get().n,2);
 await assert.rejects(f.phone.importDatabase({...body,pgn:body.pgn.replace('new','different')}),/changed before it finished/);
 const before=f.bridge.source.prepare('SELECT count(*) n FROM collection').get().n;
 await assert.rejects(f.phone.importDatabase({clientId:'dupe',name:'Duplicates',pgn:pgn('one')+'\n\n'+pgn('two')}),/repeated game identities/);
 assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM collection').get().n,before);
});

test('actual personal catalogue carries desktop archive labels and writes only checked metadata',async t=>{
 const f=await fixture(t),before=f.phone.revision;f.bridge.source.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('files.state',JSON.stringify({Empty:{archived:true,pinned:true}}));
 await f.phone.refresh();assert.notEqual(f.phone.revision,before);const snapshot=f.phone.archives();assert(snapshot.hostedPaths.includes('Empty'));
 const collection=f.phone.manifest(new URL('http://local')).databases[0];const saved=f.phone.setArchive({libraryId:f.phone.id,path:collection.path,archived:true,expected:snapshot.targets[collection.path]});
 assert(saved.hostedPaths.includes(collection.path));assert.equal(saved.collectionPaths['1'],collection.path);assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM game_record').get().n,1);
 f.phone.setArchive({libraryId:f.phone.id,path:'Empty',archived:false,expected:saved.targets.Empty});assert.equal(JSON.parse(f.bridge.source.prepare("SELECT value FROM meta WHERE key='files.state'").get().value).Empty.pinned,true);
});
