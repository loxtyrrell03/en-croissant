import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DatabaseSyncBridge,collectionPath} from './databases.mjs';
import {JsonLineProcess} from './rpc.mjs';
import {openEn,enRow,rowHash,writeEncoded,transaction,pgnFromRow} from './en-database.mjs';

const pgn=(event='Original',comment='original')=>`[Event "${event}"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n[Custom "preserved"]\n\n1. e4 {${comment}} (1. d4 d5) e5 *`;
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'personal-bridge-test-'));
  const dir=path.join(root,'app.outpost.chess.dev');fs.mkdirSync(dir);const library=path.join(dir,'library.sqlite');fs.writeFileSync(library,'');
  const codec=new JsonLineProcess(path.resolve('src-tauri/target/debug/personal-chess-sync-codec.exe'));
  const native=new JsonLineProcess(path.resolve('../outpost-chess/src-tauri/target/debug/novelty-dev-personal-sync.exe'));
  let bridge;
  t.after(()=>{bridge?.close();codec.close();native.close();fs.rmSync(root,{recursive:true,force:true});});
  const added=await native.request({library,collection:1,pgn:pgn()});
  bridge=new DatabaseSyncBridge({library,enRoot:path.join(root,'en'),ledger:path.join(root,'ledger.sqlite'),codec,native,canMove:()=>true});
  const result=await bridge.initialize();assert.deepEqual(result.errors,[]);assert.equal(result.games,1);
  const file=bridge.path(collectionPath(bridge.collections()[0]));
  const sourcePgn=()=>bridge.source.prepare('SELECT pgn FROM game_record WHERE id=?').get(added.id)?.pgn;
  const editEn=async comment=>{const en=openEn(file);try{transaction(en,()=>writeEncoded(en,{id:added.id,encoded:comment,expected:rowHash(enRow(en,added.id))}));}finally{en.close();}};
  const tick=async()=>{const report=await bridge.tick();assert.deepEqual(report.errors,[]);return report;};
  return{root,library,bridge,codec,native,id:added.id,file,sourcePgn,editEn,tick};
}

test('personal bridge mirrors annotated game edits in both directions while keeping IDs and custom tags',async t=>{
  const f=await fixture(t);
  await f.native.request({library:f.library,id:f.id,expected:f.sourcePgn(),pgn:pgn('Original','from Novelty')});
  assert.equal((await f.tick()).changed,1);
  let en=openEn(f.file);let exported=await pgnFromRow(enRow(en,f.id),f.codec,f.sourcePgn());en.close();assert.match(exported,/from Novelty/);assert.match(exported,/d4/);
  await f.editEn(await f.codec.request({pgn:pgn('Original','from En')}));assert.equal((await f.tick()).changed,1);assert.match(f.sourcePgn(),/from En/);assert.match(f.sourcePgn(),/Custom "preserved"/);
  assert.equal((await f.tick()).changed,0);
});

test('simultaneous edits and delete-versus-edit are retained as conflicts',async t=>{
  const f=await fixture(t);
  await f.native.request({library:f.library,id:f.id,expected:f.sourcePgn(),pgn:pgn('Original','left change')});
  await f.editEn(await f.codec.request({pgn:pgn('Original','right change')}));
  assert.equal((await f.tick()).conflicts.length,1);assert.match(f.sourcePgn(),/left change/);
  const en=openEn(f.file);en.prepare('DELETE FROM Games WHERE ID=?').run(f.id);en.close();assert.equal((await f.tick()).conflicts.length,1);assert.match(f.sourcePgn(),/left change/);
});

test('a deletion propagates with recovery records and removes derived position hits',async t=>{
  const f=await fixture(t);const en=openEn(f.file);en.prepare('DELETE FROM Games WHERE ID=?').run(f.id);en.close();
  assert.equal((await f.tick()).changed,1);assert.equal(f.sourcePgn(),undefined);assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM position_hit').get().n,0);
  assert.equal(f.bridge.ledger.prepare('SELECT count(*) n FROM recovery').get().n,1);assert.equal(f.bridge.source.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('new games travel in both directions without duplicate imports on repeat',async t=>{
  const f=await fixture(t);await f.native.request({library:f.library,collection:1,pgn:pgn('Added left')});assert.equal((await f.tick()).changed,1);
  const en=openEn(f.file);const encoded=await f.codec.request({pgn:pgn('Added right')});transaction(en,()=>writeEncoded(en,{id:123,encoded,expected:null}));en.close();assert.equal((await f.tick()).changed,1);assert.equal((await f.tick()).changed,0);
  assert.equal(f.bridge.source.prepare('SELECT count(*) n FROM game_record').get().n,3);
});

test('an uncertain completed insert is adopted and a missing container never deletes its games',async t=>{
  const f=await fixture(t);const en=openEn(f.file);const encoded=await f.codec.request({pgn:f.sourcePgn()});transaction(en,()=>writeEncoded(en,{id:f.id,encoded,expected:rowHash(enRow(en,f.id))}));en.close();
  f.bridge.ledger.prepare('UPDATE sync_games SET base_pgn=NULL,right_hash=NULL').run();assert.equal((await f.tick()).conflicts.length,0);
  fs.renameSync(f.file,f.file+'.moved');assert.equal((await f.tick()).conflicts.length,1);assert(f.sourcePgn());
});

test('production identities are rejected before any database access',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'personal-identity-test-'));try{const file=path.join(root,'library.sqlite');fs.writeFileSync(file,'');assert.throws(()=>new DatabaseSyncBridge({library:file,enRoot:path.join(root,'en'),ledger:path.join(root,'ledger')}),/Novelty Dev/);assert.equal(fs.statSync(file).size,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('new databases and renamed folders are reconciled in both directions',async t=>{
  const f=await fixture(t);
  f.bridge.source.prepare('UPDATE collection SET name=?,folder=? WHERE id=1').run('Changed','Preparation/White');
  assert.equal((await f.tick()).changed,1);
  const mapped=f.bridge.ledger.prepare('SELECT * FROM sync_collections WHERE id=1').get();assert.equal(mapped.relative,'Preparation/White/Changed [1].db3');assert(fs.existsSync(f.bridge.path(mapped.relative)));
  const next='Preparation/Black/Renamed.db3';fs.mkdirSync(path.dirname(f.bridge.path(next)),{recursive:true});fs.renameSync(f.bridge.path(mapped.relative),f.bridge.path(next));
  assert.equal((await f.tick()).changed,1);assert.equal(f.bridge.collections()[0].name,'Renamed');assert.equal(f.bridge.collections()[0].folder,'Preparation/Black');
  const added=f.bridge.source.prepare('INSERT INTO collection(name) VALUES(?)').run('New in Dev');assert.equal((await f.tick()).changed,1);assert(f.bridge.ledger.prepare('SELECT * FROM sync_collections WHERE id=?').get(added.lastInsertRowid));
  const en=openEn(path.join(f.bridge.enRoot,'New in En.db3'),{create:true,name:'New in En'});const encoded=await f.codec.request({pgn:pgn('From new database')});transaction(en,()=>writeEncoded(en,{id:1,encoded,expected:null}));en.close();
  assert.equal((await f.tick()).changed,2);assert(f.bridge.collections().some(c=>c.name==='New in En'));assert.equal((await f.tick()).changed,0);
});

test('container deletion waits for stable absence, retains recovery, and refuses a concurrently edited database',async t=>{
  const f=await fixture(t);fs.renameSync(f.file,f.file+'.removed');
  await f.tick();assert(f.sourcePgn());
  f.bridge.ledger.prepare("UPDATE sync_meta SET value='0' WHERE key='missing:1:right'").run();
  assert.equal((await f.tick()).changed,1);assert.equal(f.bridge.collections().length,0);assert.equal(f.bridge.ledger.prepare("SELECT count(*) n FROM recovery WHERE kind='deleted-novelty-collection'").get().n,1);
  f.bridge.source.prepare("INSERT INTO collection(name) VALUES('Recreated')").run();
  assert.equal(f.bridge.collections()[0].id,1);assert.equal((await f.tick()).changed,1);assert.equal(f.bridge.ledger.prepare('SELECT name FROM sync_collections WHERE id=1').get().name,'Recreated');
});
