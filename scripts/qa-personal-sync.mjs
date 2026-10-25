import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {DatabaseSyncBridge} from './personal-sync/databases.mjs';
import {PersonalLibrary} from './personal-sync/library.mjs';
import {JsonLineProcess} from './personal-sync/rpc.mjs';
import {openEn,enRow,rowHash,writeEncoded,transaction,pgnFromRow} from './personal-sync/en-database.mjs';
const require=createRequire(process.env.FIDE_QA_DEPENDENCIES||import.meta.url),{chromium}=require('playwright');
const output=path.resolve('tmp/personal-sync/qa'),fixture=await fs.mkdtemp(path.join(os.tmpdir(),'personal-qa-'));
await fs.mkdir(output,{recursive:true});await fs.mkdir(path.join(fixture,'app.outpost.chess.dev'));
const library=path.join(fixture,'app.outpost.chess.dev/library.sqlite');await fs.writeFile(library,'');
const native=new JsonLineProcess(path.resolve('../outpost-chess/src-tauri/target/debug/novelty-dev-personal-sync.exe')),codec=new JsonLineProcess(path.resolve('src-tauri/target/debug/personal-chess-sync-codec.exe'));
const original='[Event "Synthetic fixture"]\n[White "Example White"]\n[Black "Example Black"]\n[Result "*"]\n\n1. e4 {original note} (1. d4 d5) e5 *';
await native.request({library,collection:1,pgn:original});
const bridge=new DatabaseSyncBridge({library,enRoot:path.join(fixture,'en'),ledger:path.join(fixture,'ledger.sqlite'),codec,native});await bridge.initialize();
await fs.mkdir(path.join(fixture,'files'));const phone=new PersonalLibrary({bridge,filesRoot:path.join(fixture,'files'),recoveryRoot:path.join(fixture,'recovery'),id:'qa-fixture'});await phone.refresh();
let offline=false;
const api=createServer((req,res)=>{void(async()=>{
 res.setHeader('content-type','application/json');res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-methods','GET,PUT,OPTIONS');
 if(req.method==='OPTIONS'){res.end();return;}if(offline){res.writeHead(503);res.end(JSON.stringify({error:'Shared library is offline. Your phone edits are preserved.'}));return;}
 const url=new URL(req.url,'http://fixture');
 if(url.pathname.endsWith('/status')){res.end(JSON.stringify({enabled:true,id:'qa-fixture',phase:'synced',revision:phone.revision}));return;}
 if(url.pathname.endsWith('/game')){let value;if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);value=await phone.save(JSON.parse(Buffer.concat(chunks)));}else value=await phone.game(url.searchParams.get('ref'));res.end(JSON.stringify(value));return;}
 res.writeHead(404);res.end('{}');
})().catch(e=>{res.writeHead(e.status??400);res.end(JSON.stringify({error:e.message}));});});await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const apiOrigin=`http://127.0.0.1:${api.address().port}`;
const initial=await phone.game('database:1:1');
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{MantineProvider,Button,Text,Stack}from'@mantine/core';import'@mantine/core/styles.css';import PhonePersonalSync from'/src/web/PhonePersonalSync';import{webStateSession as session}from'/src/web/webStateSession';import{createEmptyWebState,saveWebState}from'/src/web/storage';import{parsePgnDatabase}from'/src/web/pgn';
const pgn=${JSON.stringify(initial.pgn)};const imported=parsePgnDatabase('Synthetic fixture',pgn,1);const state=createEmptyWebState();state.personalSyncId='qa-fixture';state.databases=[imported.database];state.gamesByDatabase[imported.database.id]=imported.games;await saveWebState(state);await session.load();
window.fx={session,edit(note){session.setState(s=>({...s,gamesByDatabase:{...s.gamesByDatabase,[imported.database.id]:s.gamesByDatabase[imported.database.id].map(g=>({...g,pgn:g.pgn.replace(/\\{[^}]*\\}/,'{ '+note+' }')}))}}));},pgn(){return session.getSnapshot().state.gamesByDatabase[imported.database.id][0].pgn;}};
function App(){const snapshot=React.useSyncExternalStore(session.subscribe,session.getSnapshot);return <MantineProvider defaultColorScheme="dark"><Stack p="sm"><Text>Synthetic sync fixture</Text><PhonePersonalSync/><Button onClick={()=>window.fx.edit('phone annotation')}>Add phone annotation</Button><Text data-testid="saved" style={{overflowWrap:"anywhere"}}>{snapshot.state.gamesByDatabase[imported.database.id][0].pgn}</Text></Stack></MantineProvider>};createRoot(document.getElementById('root')).render(<App/>);`;
await fs.writeFile(path.join(output,'entry.tsx'),entry);
const relative=path.relative(process.cwd(),output).replaceAll('\\','/');await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/${relative}/entry.tsx"></script></body></html>`);
await build({configFile:false,plugins:[react()],resolve:{alias:{'@':path.resolve('src')}},define:{'import.meta.env.VITE_EN_CROISSANT_SERVER_URL':JSON.stringify(apiOrigin),'import.meta.env.VITE_EN_CROISSANT_HOME_BUILD':JSON.stringify('0')},build:{target:'esnext',outDir:path.join(output,'bundle'),emptyOutDir:false,copyPublicDir:false,rollupOptions:{input:path.join(output,'index.html')}},logLevel:'warn'});
const server=await preview({configFile:false,build:{outDir:path.join(output,'bundle')},preview:{host:'127.0.0.1',port:0}});
const url=server.resolvedUrls.local[0]+relative+'/index.html',browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:560,height:900}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);await page.getByText('Shared library connected',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Add phone annotation'}).click();await page.waitForFunction(()=>window.fx.pgn().includes('phone annotation')&&!window.fx.session.hasUnsavedChanges());
 await page.waitForTimeout(1200);assert.match(bridge.source.prepare('SELECT pgn FROM game_record WHERE id=1').get().pgn,/phone annotation/);
 assert.deepEqual((await bridge.tick()).errors,[]);
 const mapping=bridge.ledger.prepare('SELECT relative FROM sync_collections WHERE id=1').get(),en=openEn(bridge.path(mapping.relative));
 assert.match(await pgnFromRow(enRow(en,1),codec),/phone annotation/);
 const encoded=await codec.request({pgn:original.replace('original note','from En Croissant')});transaction(en,()=>writeEncoded(en,{id:1,encoded,expected:rowHash(enRow(en,1))}));en.close();await bridge.tick();await phone.refresh();
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>window.fx.pgn().includes('from En Croissant'));
 offline=true;await page.evaluate(()=>window.fx.edit('offline phone note'));await page.getByRole('alert').filter({hasText:'offline'}).waitFor();
 assert.match(await page.evaluate(()=>window.fx.pgn()),/offline phone note/);assert.doesNotMatch(bridge.source.prepare('SELECT pgn FROM game_record WHERE id=1').get().pgn,/offline phone note/);
 offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByText('Shared library connected',{exact:true}).waitFor();assert.match(bridge.source.prepare('SELECT pgn FROM game_record WHERE id=1').get().pgn,/offline phone note/);
 offline=true;await page.evaluate(()=>window.fx.edit('retained phone conflict'));await page.getByRole('alert').waitFor();const expected=bridge.source.prepare('SELECT pgn FROM game_record WHERE id=1').get().pgn;await native.request({library,id:1,expected,pgn:original.replace('original note','concurrent PC note')});
 offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByRole('alert').filter({hasText:'changed on the PC'}).waitFor();assert.match(await page.evaluate(()=>window.fx.pgn()),/retained phone conflict/);
 for(const width of [1200,560,360]){await page.setViewportSize({width,height:900});for(const scale of [1,2]){await page.evaluate(scale=>document.documentElement.style.fontSize=16*scale+'px',scale);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`sync-${width}-${scale}.png`),fullPage:true});}}
 await page.getByRole('button',{name:'About library sync'}).click();await page.getByText(/Downloaded references stay read-only/).waitFor();assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({passed:true,checks:['phone to Dev to En','En to Dev to phone','offline edit retry','concurrent edit retained','1200/560/360px and 200% text','touch help'],pageErrors:errors},null,2));console.log('Personal sync browser and native fixture checks passed.');
}finally{await context.close();await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));await new Promise(resolve=>api.close(resolve));bridge.close();native.close();codec.close();await fs.rm(fixture,{recursive:true,force:true});}
