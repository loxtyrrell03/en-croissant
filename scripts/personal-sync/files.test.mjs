import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncFiles, applyItem, readItem, contained, scan } from './files.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'personal-sync-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const leftRoot=path.join(root,'dev'),rightRoot=path.join(root,'en');
  await Promise.all([leftRoot,rightRoot].map(p=>fs.mkdir(p)));
  return {leftRoot,rightRoot,statePath:path.join(root,'state.json'),recovery:path.join(root,'recovery')};
}
test('Novelty baseline wins initially and keeps displaced bytes recoverable',async t=>{
  const f=await fixture(t); await fs.writeFile(path.join(f.leftRoot,'game.pgn'),'dev annotations');await fs.writeFile(path.join(f.rightRoot,'game.pgn'),'old en annotations');
  await fs.writeFile(path.join(f.rightRoot,'old.pgn'),'unique old game');
  const dry=await syncFiles({...f,initialize:true,dryRun:true});assert.equal(dry.changed.length,2);assert.equal(await fs.readFile(path.join(f.rightRoot,'old.pgn'),'utf8'),'unique old game');
  await syncFiles({...f,initialize:true});assert.equal(await fs.readFile(path.join(f.rightRoot,'game.pgn'),'utf8'),'dev annotations');
  const recovered=await Promise.all((await fs.readdir(f.recovery)).map(d=>fs.readFile(path.join(f.recovery,d,'before'),'utf8')));assert.deepEqual(new Set(recovered),new Set(['old en annotations','unique old game']));
  await assert.rejects(syncFiles({...f,initialize:true}),/already/);
});
test('edits, nested folders, empty folders, deletes and renames travel both ways',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.leftRoot,'Empty'));await fs.mkdir(path.join(f.leftRoot,'Folder'));await fs.writeFile(path.join(f.leftRoot,'Folder','a.pgn'),'a');
  await syncFiles({...f,initialize:true});assert((await fs.stat(path.join(f.rightRoot,'Empty'))).isDirectory());
  await fs.writeFile(path.join(f.rightRoot,'Folder','a.pgn'),'annotated');await syncFiles(f);assert.equal(await fs.readFile(path.join(f.leftRoot,'Folder','a.pgn'),'utf8'),'annotated');
  await fs.rename(path.join(f.rightRoot,'Folder'),path.join(f.rightRoot,'Renamed'));await syncFiles(f);assert.equal(await fs.readFile(path.join(f.leftRoot,'Renamed','a.pgn'),'utf8'),'annotated');
  await fs.unlink(path.join(f.leftRoot,'Renamed','a.pgn'));await fs.rmdir(path.join(f.leftRoot,'Renamed'));await syncFiles(f);assert.equal((await scan(f.rightRoot)).size,1);
});
test('simultaneous edit and delete/edit conflicts never silently choose a winner',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.leftRoot,'g.pgn'),'base');await syncFiles({...f,initialize:true});
  await fs.writeFile(path.join(f.leftRoot,'g.pgn'),'left');await fs.writeFile(path.join(f.rightRoot,'g.pgn'),'right');assert.deepEqual((await syncFiles(f)).conflicts,['g.pgn']);
  await fs.unlink(path.join(f.leftRoot,'g.pgn'));assert.deepEqual((await syncFiles(f)).conflicts,['g.pgn']);assert.equal(await fs.readFile(path.join(f.rightRoot,'g.pgn'),'utf8'),'right');
});
test('an arriving save cannot be clobbered during staged publication',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.leftRoot,'g.pgn'),'next');await fs.writeFile(path.join(f.rightRoot,'g.pgn'),'base');
  await assert.rejects(applyItem({root:f.rightRoot,relative:'g.pgn',expected:await readItem(f.rightRoot,'g.pgn'),next:await readItem(f.leftRoot,'g.pgn'),recovery:f.recovery,beforePublish:()=>fs.writeFile(path.join(f.rightRoot,'g.pgn'),'concurrent')}),/exist/i);
  assert.equal(await fs.readFile(path.join(f.rightRoot,'g.pgn'),'utf8'),'concurrent');
  assert.equal(await fs.readFile(path.join(f.recovery,(await fs.readdir(f.recovery))[0],'before'),'utf8'),'base');
});
test('a missing root, unsafe path, changed roots or unreadable baseline never means deletion',async t=>{
  const f=await fixture(t);await syncFiles({...f,initialize:true});await fs.rmdir(f.rightRoot);await assert.rejects(syncFiles(f));
  for(const p of ['../x','a/../x','C:/x','a\\b','a//b'])assert.throws(()=>contained(f.leftRoot,p));
  await fs.mkdir(f.rightRoot);await fs.writeFile(f.statePath,'broken');await assert.rejects(syncFiles(f));
});
test('adding a populated folder after initialization creates parents first',async t=>{
 const f=await fixture(t);await syncFiles({...f,initialize:true});await fs.mkdir(path.join(f.leftRoot,'New'));await fs.writeFile(path.join(f.leftRoot,'New','g.pgn'),'new');await syncFiles(f);assert.equal(await fs.readFile(path.join(f.rightRoot,'New','g.pgn'),'utf8'),'new');
});
test('an interrupted replacement restores recovery before interpreting absence as deletion',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.leftRoot,'g.pgn'),'base');await syncFiles({...f,initialize:true});
 await fs.writeFile(path.join(f.leftRoot,'g.pgn'),'next');
 await assert.rejects(applyItem({root:f.rightRoot,relative:'g.pgn',expected:await readItem(f.rightRoot,'g.pgn'),next:await readItem(f.leftRoot,'g.pgn'),recovery:f.recovery,beforePublish:()=>{throw Error('simulated exit');}}),/simulated/);
 await syncFiles(f);assert.equal(await fs.readFile(path.join(f.rightRoot,'g.pgn'),'utf8'),'next');assert.equal(await fs.readFile(path.join(f.leftRoot,'g.pgn'),'utf8'),'next');
});
test('bounded parallel reads keep complete, stable file catalogues across scans',async t=>{
 const f=await fixture(t);for(let i=0;i<40;i++)await fs.writeFile(path.join(f.leftRoot,`game-${i}.pgn`),`content ${i}`);
 const first=await scan(f.leftRoot),second=await scan(f.leftRoot);assert.equal(first.size,40);assert.deepEqual([...first.keys()],[...second.keys()]);assert.deepEqual([...first.keys()],[...first.keys()].sort((a,b)=>a.localeCompare(b)));
 await syncFiles({...f,initialize:true});assert.deepEqual([...await scan(f.rightRoot)].map(([p,v])=>[p,v.hash]),[...first].map(([p,v])=>[p,v.hash]));
});

test('atomic review staging is never mirrored or mistaken for content deletion',async t=>{
 const f=await fixture(t);const transient='My online games.mistake-review.json.9340.next';
 await fs.writeFile(path.join(f.leftRoot,'My online games.mistake-review.json'),'saved');await fs.writeFile(path.join(f.leftRoot,transient),'in flight');
 await fs.writeFile(path.join(f.leftRoot,'ordinary.next'),'personal');await fs.writeFile(path.join(f.leftRoot,'notes.json.9340.next'),'personal json');
 await syncFiles({...f,initialize:true});assert.equal((await scan(f.rightRoot)).size,3);assert.equal(await fs.readFile(path.join(f.rightRoot,'ordinary.next'),'utf8'),'personal');
 const state=JSON.parse(await fs.readFile(f.statePath,'utf8'));state.entries[transient]={left:{kind:'file',hash:'stale'},right:{kind:'file',hash:'stale'}};await fs.writeFile(f.statePath,JSON.stringify(state));
 await fs.writeFile(path.join(f.rightRoot,transient),'old staging');const report=await syncFiles(f);assert.equal(report.changed.length,0);assert.equal(await fs.readFile(path.join(f.rightRoot,transient),'utf8'),'old staging');
});
