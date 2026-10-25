import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const exe=path.resolve('src-tauri/target/debug/personal-chess-sync-codec.exe');
function request(value){const result=spawnSync(exe,[],{input:JSON.stringify(value)+'\n',encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
test('native codec preserves root comments, variations, NAGs and board drawings',()=>{
 const encoded=request({pgn:'[Event "Sync fixture"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n[Custom "keep me"]\n\n{root [%csl Ge4]} 1. e4 $1 {main [%cal Ge2e4]} (1. d4 d5 (1... Nf6 {branch})) e5 *'});
 assert.equal(encoded.ok,true,encoded.error);assert.equal(encoded.value.headers.Custom,'keep me');assert.equal(encoded.value.plyCount,2);
 const decoded=request({moves:encoded.value.moves});assert.equal(decoded.ok,true,decoded.error);
 for(const fragment of ['root','[%csl Ge4]','e4!','[%cal Ge2e4]','d4','d5','Nf6','branch'])assert(decoded.value.movetext.includes(fragment),decoded.value.movetext);
 const again=request({pgn:'[Result "*"]\n\n'+decoded.value.movetext+' *'});assert.equal(again.value.moves,encoded.value.moves);
});
test('custom starts and promotions round trip without starting-position substitution',()=>{
 const fen='7k/P7/8/8/8/8/8/7K w - - 0 32';
 const encoded=request({pgn:`[FEN "${fen}"]\n[SetUp "1"]\n[Result "*"]\n\n32. a8=Q+ *`});assert.equal(encoded.ok,true,encoded.error);
 const decoded=request({moves:encoded.value.moves,fen});assert.equal(decoded.ok,true,decoded.error);assert.match(decoded.value.movetext,/a8=Q/);
});
test('illegal moves and malformed encoded data are rejected rather than silently truncated',()=>{
 assert.equal(request({pgn:'[Result "*"]\n\n1. e4 e5 2. Ke3 *'}).ok,false);
 assert.equal(request({moves:'fdffff'}).ok,false);
 assert.equal(request({moves:'',fen:'invalid'}).ok,false);
});
test('header-only saved games remain representable',()=>{
 const result=request({pgn:'[Event "Unplayed"]\n[Result "*"]\n\n*'});assert.equal(result.ok,true,result.error);assert.equal(result.value.plyCount,0);
});
