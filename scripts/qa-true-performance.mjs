import {chromium} from 'playwright';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'.'), out=resolve(root,'tmp/true-performance-qa');await mkdir(out,{recursive:true});
const phone=process.argv.includes('--phone');
const desktop=process.argv.includes('--desktop');
const fixtureModules={
 '@tanstack/react-router':`export const useNavigate=()=>route=>window.accountSetupRoute=route.to;`,
 '@/state/store/database':`const state={database:{file:'fixture.db3',title:'Fixture online games'}};export const useActiveDatabaseViewStore=selector=>selector(state);`,
 '@/state/atoms':`import {atom} from 'jotai';export const onlineDatabaseUpdatesAtom=atom({});export const accountStatsLinkedDatabaseAtom=atom(null);`,
 '@/utils/onlineGameImport':`const record={source:'chesscom',username:'sample'};export const getOnlineDatabaseUpdateRecord=()=>location.search.includes("desktop-empty")?null:record;export const getOnlineDatabaseUpdateAccounts=record=>[record];export const getOnlineGameSourceLabel=source=>source==='chesscom'?'Chess.com':'Lichess';`,
 '@/utils/accountStats':`export const accountStatsPeriodLabel=x=>x;export const accountStatsSpeedLabel=x=>x;export const computeAccountStats=async opts=>({...opts,benchmarkSpeed:'blitz',games:0,wins:0,draws:0,losses:0,scorePct:0,lichessRating:null,evalMoves:0,clockMoves:0,ratingSource:'Fixture',benchmarkSource:'Fixture',metrics:[],comparisons:[]});`,
};
const fixturePlugin={name:'desktop-stats-view-model-fixture',enforce:'pre',resolveId(id){if(desktop){const key=Object.keys(fixtureModules).find(key=>id===key||id.replace(/\\/g,'/').replace(/\.ts$/,'')===resolve(root,'src',key.slice(2)).replace(/\\/g,'/'));if(key)return `\0fixture:${key}`;}},load(id){if(id.startsWith('\0fixture:'))return fixtureModules[id.slice(9)];}};
const theme=phone?`import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';import Stats from '/src/web/StatsWorkspace';${desktop?`import DesktopStats from '/src/components/databases/AccountStatsPanel';`:''}`:`import '/src/design/tokens.css';`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {TruePerformanceOnline} from '/src/shared/TruePerformanceOnline';${theme}
const accounts=[{id:'chesscom:sample',provider:'chesscom',username:'sample'},{id:'lichess:sample',provider:'lichess',username:'sample'}];
window.errors=[];window.addEventListener('error',e=>window.errors.push(e.message));
const mode=new URLSearchParams(location.search).get('mode');
let App=()=>React.createElement(TruePerformanceOnline,{accounts,compact:mode==='compact',onViewAll:()=>window.viewAll=true});
${phone?`if(mode==='phone'){localStorage.setItem('en-croissant-web-stats-settings',JSON.stringify({source:'chesscom',chesscomUsername:'sample',timeClass:'blitz',rated:'rated',period:'30',tab:'overview'}));App=()=>React.createElement(MantineProvider,{forceColorScheme:'dark'},React.createElement(Stats));}`:''}
${desktop?`if(mode==='desktop'||mode==='desktop-empty'){App=()=>React.createElement(MantineProvider,{forceColorScheme:'dark'},React.createElement('div',{style:{height:'900px'}},React.createElement(DesktopStats)));}`:''}
${phone?'':`if(mode==='home'||mode==='home-empty'){if(mode==='home-empty')accounts.length=0;localStorage.setItem('outpost.accounts',JSON.stringify(accounts.map(a=>({...a,addedAt:new Date().toISOString(),stats:{ratings:{blitz:1900},fetchedAt:new Date().toISOString()}}))));const Home=(await import('/src/features/home/HomeSurface')).HomeSurface;const Accounts=(await import('/src/features/accounts/AccountsSurface')).AccountsSurface;const {useNavigation}=await import('/src/app/navigation');App=()=>React.createElement(useNavigation(s=>s.surface)==='accounts'?Accounts:Home);}
if(mode==='accounts'){localStorage.setItem('outpost.accounts',JSON.stringify(accounts.map(a=>({...a,addedAt:new Date().toISOString(),stats:{ratings:{blitz:1900},fetchedAt:new Date().toISOString()}}))));App=(await import('/src/features/accounts/AccountsSurface')).AccountsSurface;}`}
createRoot(document.getElementById('root')).render(React.createElement(App));`;
await writeFile(resolve(out,'entry.tsx'),entry);
await writeFile(resolve(out,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#141416;color:#e8e8ea;font-family:Segoe UI,sans-serif"><main id="root" style="box-sizing:border-box;max-width:1240px;margin:auto;padding:24px;min-height:100vh"></main><script type="module" src="/tmp/true-performance-qa/entry.tsx"></script></body></html>`);
await build({root,configFile:false,plugins:[fixturePlugin,react()],resolve:{alias:{'~':resolve(root,'src'),'@':resolve(root,'src')}},logLevel:'warn',build:{outDir:resolve(out,'bundle'),emptyOutDir:false,copyPublicDir:!phone,rollupOptions:{input:resolve(out,'index.html')}}});
const previewServer=await preview({root,configFile:false,build:{outDir:resolve(out,'bundle')},preview:{port:0,host:'127.0.0.1'}});
const server={...previewServer,close:()=>new Promise(resolve=>previewServer.httpServer.close(resolve))};
const origin=server.resolvedUrls.local[0].replace(/\/$/,'');const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1200,height:1100}});const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
const now=Math.floor(Date.now()/1000);
function chessGames(speed){return Array.from({length:speed==='rapid'?22:84},(_,i)=>{const at=now-(83-i)*6*3600,r=1870+i;return {url:`https://www.chess.com/game/live/${1000+i}`,rules:'chess',rated:true,time_class:speed,end_time:at,white:{username:i%2?'rival_'+i:'sample',rating:r,result:i%3?'win':'resigned'},black:{username:i%2?'sample':'rival_'+i,rating:r-20,result:i%3?'resigned':'win'},pgn:`[WhiteElo "${r}"]\n[BlackElo "${r-20}"]\n[ECO "B20"]\n[Opening "Sicilian Defence"]`};});}
await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();
 if(u.hostname==='api.chess.com'){if(u.pathname.endsWith('/archives'))return route.fulfill({json:{archives:['https://api.chess.com/pub/player/sample/games/2026/09']}});if(u.pathname.endsWith('/stats'))return route.fulfill({json:{}});return route.fulfill({json:{games:[...chessGames('blitz'),...chessGames('rapid'),...chessGames('blitz').slice(-10).map(g=>({...g,rated:false,url:g.url+'9'}))]}});}
 if(u.hostname==='lichess.org'&&u.pathname.includes('/api/games/user/'))return route.fulfill({contentType:'application/x-ndjson',body:Array.from({length:12},(_,i)=>JSON.stringify({id:`game${String(i).padStart(4,'0')}`,variant:'standard',rated:true,speed:u.searchParams.get('perfType'),status:'mate',winner:i%2?'white':'black',createdAt:(now-(12-i)*86400)*1000,players:{white:{user:{name:'sample'},rating:2200},black:{user:{name:'rival'},rating:2100}}})).join('\n')});
 if(u.hostname==='lichess.org'&&u.pathname.includes('/api/user/'))return route.fulfill({json:{}});
 external.push(u.href);return route.abort();});
try{
 await page.goto(`${origin}/tmp/true-performance-qa/index.html`);await page.getByLabel('Performance period').waitFor();
 await page.locator('[class*="selectionLine"]').getByText('84 rated games',{exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox').count(),5);
 await page.getByLabel('Performance period').selectOption('20g');await page.locator('[class*=\"selectionLine\"]').getByText('20 rated games',{exact:true}).waitFor();
 await page.getByLabel('Performance game type').selectOption('unrated');
 await page.locator('[class*=\"selectionLine\"]').getByText('10 unrated games',{exact:true}).waitFor();
 await page.getByLabel('Performance game type').selectOption('both');
 await page.getByLabel('Performance period').selectOption('all');await page.locator('[class*=\"selectionLine\"]').getByText('94 games',{exact:true}).waitFor();
 await page.getByLabel('Performance game type').selectOption('rated');
 await page.getByLabel('Performance period').selectOption('20g');
 await page.locator('[class*=\"selectionLine\"]').getByText('20 rated games',{exact:true}).waitFor();
 await page.getByLabel('Explore rating history').fill('0');
 for(const width of [1200,560,390,360]){await page.setViewportSize({width,height:1100});await page.screenshot({path:resolve(out,`stats-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow ${width}`);for(const hint of await page.getByLabel('Explain this estimate').all()){await hint.hover();await hint.click();const box=await page.getByRole('tooltip').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width,`Help overflow ${width}`);await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'detached'});}}
 assert.equal(await page.getByText('After your latest game',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Compare ratings',exact:true}).click();await page.getByText('After your latest game',{exact:true}).waitFor();await page.getByRole('button',{name:'Close comparison',exact:true}).click();
 await page.getByLabel('Rating graph').selectOption('history');await page.getByRole('img',{name:'Estimated playing strength over selected games'}).waitFor();await page.getByLabel('Rating graph').selectOption('performance');
 const finalRating=await page.locator('[class*="heroRating"]').innerText();await page.getByLabel('Explore rating history').fill(String(await page.getByLabel('Explore rating history').getAttribute('max')));assert.equal(await page.locator('[class*="chartReadout"] strong').innerText(),finalRating);

 await page.getByLabel('Performance period').selectOption('all');await page.getByLabel('Performance time control').selectOption('rapid');await page.locator('[class*=\"selectionLine\"]').getByText('22 rated games',{exact:true}).waitFor();
 await page.getByLabel('Performance account').selectOption('lichess:sample');await page.locator('[class*=\"selectionLine\"]').getByText('12 rated games',{exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/Lichess · rapid/);
 await page.getByLabel('Performance period').selectOption('7d');await page.screenshot({path:resolve(out,'lichess-mobile.png'),fullPage:true});
 await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=compact`);await page.getByLabel('Performance period').waitFor();await page.getByRole('button',{name:'View all stats'}).click();assert(await page.evaluate(()=>window.viewAll));await page.screenshot({path:resolve(out,'home-compact.png'),fullPage:true});
 if(!phone){
 await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=home-empty`);
 await page.getByRole('button',{name:'View stats',exact:true}).click();
 await page.getByRole('dialog',{name:'Online stats',exact:true}).getByRole('button',{name:'Add account',exact:true}).click();
 await page.getByRole('heading',{name:'Accounts',exact:true}).waitFor();
 await page.getByRole('dialog',{name:'Add account',exact:true}).waitFor();
 await page.screenshot({path:resolve(out,'account-setup-from-stats.png'),fullPage:true});
 for(const mode of ['home','accounts']){await page.setViewportSize({width:1200,height:1100});await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=${mode}`);if(mode==='home'){
 await page.getByRole('button',{name:'View stats',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Performance period').count(),0,'Home must not embed the dashboard');
 await page.screenshot({path:resolve(out,'actual-home.png'),fullPage:true});
 await page.getByRole('button',{name:'View stats',exact:true}).click();
 await page.getByRole('dialog',{name:'Online stats',exact:true}).waitFor();
 await page.getByLabel('Performance period').selectOption('20g');
 await page.locator('[class*=\"selectionLine\"]').getByText('20 rated games',{exact:true}).waitFor();
 await page.screenshot({path:resolve(out,'actual-home-stats-open.png'),fullPage:true});
 await page.keyboard.press('Escape');
 await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.getByLabel('Performance period').count(),0);
 await page.waitForFunction(()=>document.activeElement?.textContent==='View stats');
 }else{await page.getByLabel('Performance period').waitFor();await page.screenshot({path:resolve(out,`actual-${mode}.png`),fullPage:true});}}}
 else {await page.setViewportSize({width:390,height:1000});await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=phone`);await page.getByLabel('Performance period').waitFor();await page.getByLabel('Performance period').selectOption('20g');await page.locator('[class*=\"selectionLine\"]').getByText('20 rated games',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Rated filter',exact:true}).click();await page.getByRole('option',{name:'Unrated',exact:true}).click();await page.locator('[class*=\"selectionLine\"]').getByText('10 unrated games',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Rated filter',exact:true}).click();await page.getByRole('option',{name:'Both',exact:true}).click();await page.getByLabel('Performance period').selectOption('all');await page.locator('[class*=\"selectionLine\"]').getByText('94 games',{exact:true}).waitFor();await page.getByLabel('Performance period').selectOption('20g');await page.locator('[class*=\"selectionLine\"]').getByText('20 games',{exact:true}).waitFor();await page.screenshot({path:resolve(out,'actual-phone.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 if(desktop){await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=desktop-empty`);await page.getByRole('button',{name:'Add account',exact:true}).click();assert.equal(await page.evaluate(()=>window.accountSetupRoute),'/accounts');await page.setViewportSize({width:1200,height:1000});await page.goto(`${origin}/tmp/true-performance-qa/index.html?mode=desktop`);await page.getByLabel('Performance period').waitFor();await page.screenshot({path:resolve(out,'actual-desktop.png'),fullPage:true});await page.getByText('About the estimates',{exact:true}).scrollIntoViewIfNeeded();const box=await page.getByText('About the estimates',{exact:true}).boundingBox();assert(box&&box.y>=0&&box.y+box.height<1000,'Desktop stats must scroll to the footer');await page.screenshot({path:resolve(out,'actual-desktop-scrolled.png'),fullPage:true});}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,widths:[1200,560,390,360],errors,external,actualSurfaces:phone?['StatsWorkspace',...(desktop?['AccountStatsPanel']:[])]:['HomeSurface','AccountsSurface']},null,2));console.log(`Passed: ${out}`);
}catch(error){console.error(JSON.stringify({errors,external,body:await page.locator('body').innerText()}));await page.screenshot({path:resolve(out,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await server.close();}
