import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createPersonalSyncProxy} from './home-proxy.mjs';

test('personal proxy is opt-in, checks origins, keeps its key private and never falls back to production when offline',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'personal-proxy-test-')),configPath=path.join(root,'config.json'),secret='a'.repeat(64);let seen=0,key=null;
 const upstream=createServer((req,res)=>{seen++;key=req.headers['x-personal-sync-key'];res.setHeader('content-type','application/json');res.end(JSON.stringify({enabled:true}));});
 await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(8788,'127.0.0.1',resolve);});
 const proxy=createPersonalSyncProxy({configPath,origins:new Set(['https://lox-pc.tail89d19b.ts.net'])});
 const front=createServer((req,res)=>{void proxy(req,res).then(handled=>{if(!handled)res.end('existing handler');});});await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await Promise.all([new Promise(resolve=>front.close(resolve)),new Promise(resolve=>upstream.close(resolve))]);await fs.rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${front.address().port}`;
 assert.equal(await(await fetch(base+'/web-library/manifest.json')).text(),'existing handler');assert.deepEqual(await(await fetch(base+'/api/personal-sync/status')).json(),{enabled:false});
 await fs.writeFile(configPath,JSON.stringify({enabled:true,port:8788,secret,referenceDatabases:[{path:'Databases/Desktop/Reference'}]}));
 // A fresh proxy simulates the next configuration poll without a real wait.
 const active=createPersonalSyncProxy({configPath,origins:new Set(['https://lox-pc.tail89d19b.ts.net'])});front.removeAllListeners('request');front.on('request',(req,res)=>{void active(req,res).then(handled=>{if(!handled)res.end('existing handler');});});
 const rejected=await fetch(base+'/api/personal-sync/game',{method:'PUT',headers:{origin:'https://unrelated.example','content-type':'application/json'},body:'{}'});assert.equal(rejected.status,403);assert.equal(seen,0);
 assert.equal((await fetch(base+'/api/personal-sync/game',{method:'POST',body:'form'})).status,415);assert.equal(seen,0);
 assert.equal(await(await fetch(base+'/api/database-manifest?hostedPath=Databases%2FDesktop%2FReference')).text(),'existing handler');assert.equal(seen,0);
 const accepted=await fetch(base+'/api/personal-sync/status',{headers:{origin:'https://lox-pc.tail89d19b.ts.net'}});assert.deepEqual(await accepted.json(),{enabled:true});assert.equal(key,secret);assert.equal(accepted.headers.get('x-personal-sync-key'),null);
 await new Promise(resolve=>upstream.close(resolve));
 const offline=await fetch(base+'/web-library/manifest.json');assert.equal(offline.status,503);assert.match((await offline.json()).error,/offline/);
});
