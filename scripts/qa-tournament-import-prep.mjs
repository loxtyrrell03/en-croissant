import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(process.env.FIDE_QA_DEPENDENCIES || import.meta.url);
const { chromium } = require("playwright");
const root = process.cwd(), output = path.resolve("tmp/tournament-import-prep-qa");
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "index.html"), '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./fixture.tsx"></script>');
await fs.writeFile(path.join(output, "fixture.tsx"), `
import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';
import {PhoneTournaments} from '/src/features/tournaments/PhoneTournaments';
import {desktopApi} from '/src/features/tournaments/platform';
import {trackerFixture} from '/src/features/tournaments/tests/trackerFixture';
import {parsePgnDatabase} from '/src/web/pgn';import {webStateSession} from '/src/web/webStateSession';
const params=new URL(location.href).searchParams;
const {record,forecast}=trackerFixture();record.autoUpdate=false;
record.snapshot.players=record.snapshot.players.map(p=>({...p,fideId:null}));
for(const item of Object.values(record.opponents)){item.fideId=null;item.collectionId=null;item.status='not-imported';item.gameCount=0;}
const player=record.snapshot.players[2];
const f=window.fx={record,collections:{},starts:[],lookups:[],jobs:{},opened:0,mode:params.get('mode')||'normal',rejectHandoff:params.has('saveFailure'),
 forecast:{...forecast,kind:params.has('estimated')?'estimated':'confirmed',candidates:[{...forecast.candidates[1],player,color:'black'}]},
 saved:()=>webStateSession.getSnapshot().savedState};
localStorage.setItem('encroissant.tournaments.last','42');
desktopApi.settingsGet=async()=>JSON.stringify({'42':f.record});
desktopApi.settingsSet=async(_key,value)=>{f.record=JSON.parse(value)['42'];};
desktopApi.collectionCreate=async(name,key)=>{const old=Object.values(f.collections).find(c=>c.key===key);if(old)return old.id;const id=7;f.collections[id]={id,name,key,folder:null,game_count:0,metadata:{}};return id;};
desktopApi.collectionGet=async id=>structuredClone(f.collections[id]);
desktopApi.collectionUpdate=async(id,count,metadata)=>{Object.assign(f.collections[id],{game_count:count,metadata:structuredClone(metadata)});};
desktopApi.collectionSetFolder=async(id,folder)=>{f.collections[id].folder=folder;};
const flush=webStateSession.flush;
webStateSession.flush=()=>{if(f.rejectHandoff&&webStateSession.getSnapshot().state.activePrepId){f.rejectHandoff=false;return Promise.reject(Error('Example phone storage unavailable'));}return flush();};
const realFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const p=new URL(String(url),location.href).pathname;
 if(p==='/api/otb-import/players'){f.lookups.push(String(url));return Response.json({players:[{id:77777,name:'Rivera, Samuel',country:'ENG',rating:2100}]});}
 if(!p.startsWith('/api/otb-import/jobs'))return realFetch(url,options);
 const id=p.split('/').at(-1);
 if(options.method==='PUT'){
  const request=JSON.parse(options.body);f.starts.push({id,request});
  const prepDatabase=parsePgnDatabase('fixture.pgn','[Event "Invented test"]\\n[White "Rivera, Samuel"]\\n[Black "Example Opponent"]\\n[Result "1-0"]\\n\\n1. e4 e5 2. Nf3 Nc6 1-0',1234);
  f.jobs[id]={id,request,status:f.mode==='cancel'?'running':f.mode==='fail'?'failed':'completed',error:f.mode==='fail'?'Example source unavailable':null,
   progress:{message:'Searching public games…',gamesFound:1,current:1,total:3},report:{cancelled:false},games:[],prepDatabase:f.mode==='empty'?null:prepDatabase};
 }
 if(options.method==='DELETE'){f.jobs[id].status='completed';f.jobs[id].report.cancelled=true;}
 return Response.json(f.jobs[id]);
};
document.body.style.cssText='margin:0;background:#141416';
createRoot(document.getElementById('root')).render(<MantineProvider forceColorScheme='dark'><main style={{padding:12,maxWidth:900,margin:'auto'}}><p>Invented tournament · isolated import fixture</p><PhoneTournaments onPrep={()=>{f.opened++;}} onDatabase={()=>{}} onClose={()=>{}}/></main></MantineProvider>);
`);
await build({root,configFile:false,plugins:[{name:"isolated-tournament-services",enforce:"pre",load(id){
 if(id.replaceAll("\\","/").endsWith("/features/tournaments/usePairingForecast.ts"))return 'export function usePairingForecast(){return {forecast:window.fx.forecast,isCalculating:false}}';
 if(id.replaceAll("\\","/").endsWith("/features/tournaments/services.ts"))return 'export function startTournamentServices(){}';
}},react()],resolve:{alias:{"@":path.resolve("src")}},build:{outDir:path.join(output,"bundle"),emptyOutDir:false,copyPublicDir:false,rollupOptions:{input:path.join(output,"index.html")}},logLevel:"warn"});
const server=await preview({root,configFile:false,build:{outDir:path.join(output,"bundle")},preview:{port:0,host:"127.0.0.1"}});
const origin=server.resolvedUrls.local[0].replace(/\/$/,"");
const url=origin+"/"+path.relative(root,path.join(output,"index.html")).replaceAll("\\","/");
const browser=await chromium.launch({headless:true});
const checks=[],errors=[],external=[];
const check=(name)=>checks.push(name);
async function scenario(query="",width=390){
 const context=await browser.newContext({viewport:{width,height:950}});
 await context.route("**/*",route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on("pageerror",e=>errors.push(e.message));
 await page.goto(url+"?"+query);await page.getByRole("button",{name:"Import & prep",exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 return {page,context};
}
async function start(page){
 await page.getByRole("button",{name:"Import & prep",exact:true}).click();
 await page.getByRole("combobox").waitFor();
 assert.equal(await page.getByRole("combobox").inputValue(),"Sam Rivera");
 assert.equal(await page.getByRole("button",{name:"Import & prep",exact:true}).isDisabled(),true);
 await page.getByRole("option").filter({hasText:"Rivera, Samuel"}).click();
 await page.getByRole("button",{name:"Import & prep",exact:true}).click();
}
try{
 for(const width of [320,390,760]){
  const {page,context}=await scenario(width===760?"estimated":"",width);
  if(width===320){
   await page.evaluate(()=>document.documentElement.style.fontSize='200%');
   const trigger=page.getByRole('button',{name:'Help: Choose FIDE profile for Sam Rivera',exact:true});
   await trigger.scrollIntoViewIfNeeded();await trigger.focus();
   await page.getByRole('tooltip').waitFor();
   const help=await page.getByRole('tooltip').boundingBox();
   assert.ok(help&&help.x>=0&&help.x+help.width<=320);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'hidden'});
   await page.evaluate(()=>document.documentElement.style.fontSize='');
   check('320px enlarged text and dismissible exact-profile help stay within the viewport');
  }
  await page.screenshot({path:path.join(output,`before-${width}.png`),fullPage:true});
  await start(page);await page.waitForFunction(()=>window.fx.opened===1);
  const result=await page.evaluate(()=>({starts:fx.starts,saved:fx.saved(),opponent:fx.record.opponents['3'],source:fx.record.snapshot.players[2]}));
  assert.equal(result.starts.length,1);assert.equal(result.starts[0].request.fideId,"77777");assert.equal(result.starts[0].request.fromYear,2023);
  assert.equal(result.saved.prepWorkspaces[0].userColor,"black");assert.equal(result.saved.prepWorkspaces[0].opponent,"Rivera, Samuel");
  assert.equal(result.saved.activePrepId,"prep-tournament-opponent-7");assert.equal(result.saved.gamesByDatabase["tournament-opponent-7"].length,1);
  assert.equal(result.opponent.importIdentity.fideId,"77777");assert.equal(result.source.fideId,null);
  await page.getByRole("button",{name:"Open Prep",exact:true}).click();await page.waitForFunction(()=>fx.opened===2);
  assert.equal(await page.evaluate(()=>fx.starts.length),1);
  check(`${width}px ${width===760?'estimated':'published'} opponent imports exact selected profile, persists Black Prep and reopens without collection`);
  await page.getByRole('tab',{name:'Players',exact:true}).click();await page.getByRole('button',{name:/^Sam Rivera/}).first().click();
  assert.equal(await page.evaluate(()=>{const a=document.querySelector('[aria-label="Actions for Sam Rivera"]');const b=document.querySelector('[aria-label="Player predictions"]');return !!a&&!!b&&!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)}),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,`player-${width}.png`),fullPage:true});
  check(`${width}px player preparation precedes prediction history without overflow`);
  await context.close();
 }
 {
  const {page,context}=await scenario("saveFailure");await start(page);
  await page.getByText("Example phone storage unavailable",{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fx.opened),0);
  await page.getByRole("button",{name:"Open Prep",exact:true}).click();await page.waitForFunction(()=>fx.opened===1);
  assert.equal(await page.evaluate(()=>fx.starts.length),1);check('failed Prep save stays visible and retries without recollecting');await context.close();
 }
 {
  const {page,context}=await scenario("mode=fail");await start(page);
  await page.getByText("Example source unavailable",{exact:true}).waitFor();await page.evaluate(()=>fx.mode='normal');
  await page.getByRole("button",{name:"Retry import",exact:true}).click();await page.waitForFunction(()=>fx.opened===1);
  assert.equal(await page.evaluate(()=>Object.keys(fx.collections).length),1);check('failed source retries in the same opponent collection');await context.close();
 }
 {
  const {page,context}=await scenario("mode=cancel");await start(page);
  await page.getByRole("button",{name:"Stop import",exact:true}).click();await page.getByText(/Search stopped\. 1 saved games/).waitFor();
  assert.equal(await page.evaluate(()=>fx.opened),0);
  await page.getByRole("button",{name:"Open Prep",exact:true}).click();await page.waitForFunction(()=>fx.opened===1);
  check('cancel retains partial games and explicit Open Prep uses them');await context.close();
 }
 {
  const {page,context}=await scenario("mode=empty");await start(page);await page.getByRole("button",{name:"Search again",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fx.opened),0);check('no-game completion returns to the opponent with Search again');await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await fs.writeFile(path.join(output,"receipt.json"),JSON.stringify({checks,errors,external},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,external,output},null,2));
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
