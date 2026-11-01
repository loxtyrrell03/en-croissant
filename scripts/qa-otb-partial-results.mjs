import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
const require=createRequire(process.env.FIDE_QA_DEPENDENCIES||import.meta.url),{chromium}=require('playwright');
const root=process.cwd(),out=path.resolve('tmp/otb-partial-results-qa');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./fixture.tsx"></script>');
await fs.writeFile(path.join(out,'fixture.tsx'),`
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';
import Phone from '/src/web/PhoneOtbImportPanel';import {OtbCoverageNotice} from '/src/web/OtbCoverageNotice';import {parsePgnDatabase} from '/src/web/pgn';import {loadWebState,saveWebState} from '/src/web/storage';import {applyWebOtbPrepCompletion} from '/src/web/otbPrep';
const mode=new URL(location.href).searchParams.get('mode')||'partial';
const request={playerName:'Example Player',fideId:'77777',fromYear:2024,sources:{lichessBroadcasts:true,broadcastArchives:true,communityBroadcasts:false,chessResults:true,chessbaseNews:true,officialPgnIndexes:false,twic:true}};
const prepared=parsePgnDatabase('Example OTB games.pgn','[White "Example Player"]\\n[Black "Example Opponent"]\\n[Result "1-0"]\\n\\n1. e4 e5 1-0',1234);
const game={id:'otb-example:1',pgn:prepared.games[0].pgn,white:'Example Player',black:'Example Opponent',event:'Invented event',date:'2026.10.01',result:'1-0'};
const initial={id:'otb-example',status:mode==='unknown'?'completed':'partial',request,report:{playerName:'Example Player',gamesFound:1,cancelled:mode==='stopped',...(mode==='unknown'?{}:{coverageComplete:false,coverageGaps:['Lichess live FIDE broadcasts: Lichess returned 403 Forbidden: <!DOCTYPE html><html>Just a moment']})},artifactAvailable:true,gameCount:1,createdAt:'2026-11-01T08:00:00Z',completedAt:'2026-11-01T08:01:00Z',progress:null,error:null};
if(!localStorage.getItem('encroissant-web-otb-start'))localStorage.setItem('encroissant-web-otb-job',initial.id);
window.fx={starts:[],analyzed:0,initial,request,jobs:{[initial.id]:initial},persist:async()=>{const applied=applyWebOtbPrepCompletion(await loadWebState(),{...initial,prepDatabase:prepared,games:[game]},'black');await saveWebState(applied.state);},saved:loadWebState};
const realFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const p=new URL(String(url),location.href).pathname;
 if(p==='/api/otb-import/players')return Response.json({players:[{id:77777,name:'Example Player'}]});
 if(!p.startsWith('/api/otb-import/jobs/'))return realFetch(url,options);
 const parts=p.split('/'),id=parts.at(-1)==='artifact'?parts.at(-2):parts.at(-1);
 if(options.method==='PUT'){fx.starts.push(JSON.parse(options.body));fx.jobs[id]={...initial,id,request:JSON.parse(options.body),status:'completed',report:{...initial.report,cancelled:false,coverageComplete:true,coverageGaps:[]}};}
 if(parts.at(-1)==='artifact')return Response.json({jobId:id,games:[game],prepDatabase:prepared});
 return Response.json(fx.jobs[id]||initial);
};
function Saved(){const[state,setState]=useState(null);useEffect(()=>{void loadWebState().then(setState)},[]);return <section aria-label='Saved source coverage'><OtbCoverageNotice coverage={state?.databases[0]?.otbCoverage}/></section>}
document.body.style.cssText='margin:0;background:#141416';
createRoot(document.getElementById('root')).render(<MantineProvider forceColorScheme='dark'><main style={{maxWidth:760,padding:12,margin:'auto'}}><p>Invented OTB import · isolated source failure</p><Saved/><section aria-label='Current import'><Phone onAnalyzeGame={async()=>{fx.analyzed++}}/></section></main></MantineProvider>);
`);
await build({root,configFile:false,plugins:[{name:'isolated-download-control',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/features/tournaments/OtbDownloadsPanel.tsx'))return 'export function OtbDownloadsPanel(){return null}';}},react()],resolve:{alias:{'@':path.resolve('src')}},build:{outDir:path.join(out,'bundle'),emptyOutDir:false,copyPublicDir:false,rollupOptions:{input:path.join(out,'index.html')}},logLevel:'warn'});
const server=await preview({root,configFile:false,build:{outDir:path.join(out,'bundle')},preview:{port:0,host:'127.0.0.1'}});
const origin=server.resolvedUrls.local[0].replace(/\/$/,''),url=origin+'/'+path.relative(root,path.join(out,'index.html')).replaceAll('\\','/');
const browser=await chromium.launch({headless:true}),checks=[],errors=[],external=[];
try{
 for(const mode of ['partial','unknown','stopped']){
  const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(url+'?mode='+mode);
  const current=page.getByRole('region',{name:'Current import'});
  await current.getByRole('button',{name:'Analyze',exact:true}).waitFor();
  const warning=mode==='unknown'?'Source coverage was not recorded':mode==='stopped'?'The search stopped':'Some selected sources did not finish';
  assert.match(await current.innerText(),new RegExp(warning));assert.doesNotMatch(await current.innerText(),/from the full career|<!DOCTYPE|<html/);
  await current.getByRole('button',{name:'Analyze',exact:true}).click();assert.equal(await page.evaluate(()=>fx.analyzed),1);
  await page.evaluate(()=>fx.persist());await page.reload();await page.getByRole('region',{name:'Saved source coverage'}).getByText(new RegExp(warning)).waitFor();
  assert.equal(await page.evaluate(async()=>{const s=await fx.saved();return s.prepWorkspaces[0].userColor}),'black');
  checks.push(mode+' result remains usable with warning preserved through real IndexedDB reload');
  for(const width of [320,390,760]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:1000});
  await current.getByRole('button',{name:'Retry same sources',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,mode+'.png'),fullPage:true});
  checks.push(mode+' layout fits320/390/760px');
  if(mode==='partial'){
   await page.getByLabel('Games since',{exact:true}).fill('2020');
   await current.getByRole('button',{name:'Retry same sources',exact:true}).click();await page.waitForFunction(()=>fx.starts.length===1);
   const data=await page.evaluate(()=>({sent:fx.starts[0],expected:fx.request}));assert.deepEqual(data.sent,data.expected);
   await current.getByText('Incomplete source coverage',{exact:true}).waitFor({state:'hidden'});
   checks.push('Retry same sources retains exact original identity, year and all source choices');
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify({checks,errors,external},null,2));console.log(JSON.stringify({checks:checks.length,errors,external,out}));
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
