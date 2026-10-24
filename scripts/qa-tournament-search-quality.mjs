import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(process.argv[2]??'.');
const sibling=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).name.includes('en-croissant');
const phone=process.argv[3]==='phone';
const liveOrigin=process.env.NOVELTY_QA_ORIGIN;
if(liveOrigin){
 assert.equal(sibling,false);
 const identity=await(await fetch(`${liveOrigin}/__outpost_dev_identity`)).json();
 assert.equal(identity.root.replaceAll('\\','/').toLowerCase(),root.replaceAll('\\','/').toLowerCase());
}
const out=path.join(root,`tmp/tournament-search-quality${phone?'-phone':''}`);
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'index.html'),'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="./fixture.tsx"></script>');
await fs.writeFile(path.join(out,'fixture.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {TournamentDiscovery} from '/src/features/tournaments/TournamentDiscovery';
import {discoveryCache,discoverySource,defaultDiscoveryFilters,rememberDiscoveryFilters} from '/src/features/tournaments/tournamentDiscoveryModel';
import {searchTournamentEvents} from '/src/features/tournaments/tournamentSearch';
import {desktopApi} from '${sibling?'/src/features/tournaments/platform':'/src/platform/bridge'}';
${sibling?"import {MantineProvider} from '@mantine/core';import '@mantine/core/styles.css';import {HomeModal,TournamentEmbedded} from '/src/features/tournaments/ui';":"import '/src/design/tokens.css';import '/src/design/controls.css';window.__TAURI_INTERNALS__={};"}
document.body.style.cssText='margin:0;background:#141416;color:#e8e8ea;font:14px Segoe UI,sans-serif';
localStorage.setItem('${sibling?'encroissant':'outpost'}.tournaments.images','off');
const event=(id,title,extra={})=>({tournamentId:id,title,sourceUrl:'https://chess-results.com/tnr'+id+'.aspx',section:null,federation:'ENG',startDate:'2026/11/20',endDate:'2026/11/22',lastUpdate:null,...extra});
const bristol=event('1','2026 UK Open Blitz Qualifier: Bristol',{location:'St Michaels Centre, Stoke Gifford'});
const derby=event('2','Derbyshire Congress Open');
window.fx={requests:[],opened:[],capped:false,fail:false,defer:false,pending:[],delayQuery:'',regionDelay:false,
 rows:[bristol,event('3','Blackpool Junior Championships'),event('4','West Wales Open',{federation:'WLS'})],extra:[derby],rank:searchTournamentEvents};
desktopApi.discoverTournaments=async request=>{
 fx.requests.push(request);
 if(fx.defer||fx.delayQuery&&request.query===fx.delayQuery)await new Promise(resolve=>fx.pending.push(resolve));
 if(fx.fail===true||fx.fail===request.query)throw Error('Search unavailable');
 let rows=[...fx.rows,...(request.query||request.location?fx.extra:[])];
 if(request.query)rows=rows.filter(e=>e.title.toLowerCase().includes(request.query.toLowerCase()));
 if(request.location)rows=rows.filter(e=>(e.location??'').toLowerCase().includes(request.location.toLowerCase()));
 if(request.country)rows=rows.filter(e=>e.federation===request.country);
 return {events:rows,sourceCount:fx.capped?2000:rows.length,sourceLimitReached:fx.capped,fetchedAt:new Date().toISOString()};
};
const root=createRoot(document.getElementById('root'));let epoch=0;
const view=()=> <TournamentDiscovery key={epoch} records={{}} onInspect={url=>fx.opened.push(url)} onOpen={()=>{}} busy={false} onCancel={()=>{}} error={null}/>;
const mount=()=>root.render(${sibling?`<MantineProvider forceColorScheme="dark"><TournamentEmbedded.Provider value={${phone}}><HomeModal title="Tournaments" onClose={()=>{}} wide>{view()}</HomeModal></TournamentEmbedded.Provider></MantineProvider>`:'<div style={{padding:16,maxWidth:1100,margin:"auto"}}>{view()}</div>'});
fx.reset=()=>{discoveryCache.clear();discoverySource.clear();rememberDiscoveryFilters(defaultDiscoveryFilters());epoch++;mount();};
mount();
`);
const server=await createServer({root,configFile:false,cacheDir:path.join(out,'cache'),optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime',...(sibling?['@mantine/core','@mantine/notifications']:[])]},plugins:[react({exclude:[/node_modules/,/cache/]})],resolve:{alias:{'~':path.join(root,'src'),'@':path.join(root,'src')}},server:{host:'127.0.0.1',port:0,watch:null}});
let browser,page;const checks=[],errors=[],external=[];
try{
 if(!liveOrigin)await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1100,height:1000},hasTouch:phone});
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(!['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)){external.push(r.request().url());return r.abort();}return r.continue();});
 const url=(liveOrigin?`${liveOrigin}/`:server.resolvedUrls.local[0])+`tmp/tournament-search-quality${phone?'-phone':''}/index.html`;
 const search=page.getByRole('textbox',{name:'Search tournaments',exact:true});
 const ready=()=>page.getByText('Finding tournaments…',{exact:true}).waitFor({state:'hidden'});
 const row=name=>page.getByRole('heading',{name,exact:true});
 await page.goto(url);await row('2026 UK Open Blitz Qualifier: Bristol').waitFor();await ready();
 const reads=await page.evaluate(()=>fx.requests.length);
 for(const query of ['find me a chess tournament in bristol','brsitol quali','brsit quali','bristol 2026']){await search.fill(query);await row('2026 UK Open Blitz Qualifier: Bristol').waitFor();}
 await search.fill('black pool junior champs');await row('Blackpool Junior Championships').waitFor();
 assert.equal(await page.evaluate(()=>fx.requests.length),reads);checks.push('Rough wording, typos, short names, joined/split words and published years use the cached directory');
 await page.getByLabel('Region',{exact:true}).selectOption('UK & Ireland');await page.getByLabel('Country / federation',{exact:true}).selectOption('WLS');await ready();
 await page.reload();await search.waitFor();assert.equal(await page.getByLabel('Region',{exact:true}).inputValue(),'UK & Ireland');assert.equal(await page.getByLabel('Country / federation',{exact:true}).inputValue(),'WLS');assert.equal(await search.inputValue(),'');await row('West Wales Open').waitFor();checks.push('Selected region/country survive a full reload; old query is not persisted');
 await search.fill('nothinglikeanevent');await page.getByRole('button',{name:'Search all dates',exact:true}).click();await ready();
 assert.equal(await search.inputValue(),'nothinglikeanevent');assert.equal(await page.getByLabel('Country / federation',{exact:true}).inputValue(),'WLS');
 await page.waitForFunction(()=>fx.requests.some(r=>r.period==='all'&&r.from==='1900-01-01'&&r.to==='9999-12-31'&&r.country==='WLS'));
 await page.getByRole('button',{name:'Upcoming',exact:true}).click();assert.equal(await page.getByLabel('Dates',{exact:true}).inputValue(),'3');checks.push('All-date recovery preserves query/area and returning to Upcoming restores its date window');
 await page.evaluate(()=>{fx.capped=true;fx.reset();});await page.waitForFunction(()=>document.querySelector('[aria-label="Search tournaments"]').value==='');await search.fill('derbshire congress');await row('Derbyshire Congress Open').waitFor();await ready();
 assert.ok((await page.evaluate(()=>fx.requests)).some(r=>r.query==='der'));await page.getByRole('button',{name:'Derbyshire Congress Open',exact:true}).click();assert.ok((await page.evaluate(()=>fx.opened)).includes('https://chess-results.com/tnr2.aspx'));
 checks.push('Misspelt event absent from capped browse is retrieved by a fragment and opens the correct tournament');
 await page.evaluate(()=>{fx.fail='derbshire congress';fx.reset();});await page.waitForFunction(()=>document.querySelector('[aria-label="Search tournaments"]').value==='');await search.fill('derbshire congress');await page.getByRole('alert').waitFor();await row('Derbyshire Congress Open').waitFor();
 await page.evaluate(()=>fx.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});await row('Derbyshire Congress Open').waitFor();await ready();checks.push('Successful candidates remain visible through a partial failure; retry clears the error');
 await page.evaluate(()=>{fx.capped=false;fx.defer=true;fx.requests=[];fx.reset();});await page.waitForFunction(()=>fx.pending.length>0);
 for(const query of ['br','bris','bristol']){await search.fill(query);await page.waitForTimeout(420);}
 assert.equal(await page.evaluate(()=>fx.requests.length),1);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>{fx.defer=false;fx.pending.splice(0).forEach(done=>done());});await page.waitForTimeout(100);
 assert.equal(await row('2026 UK Open Blitz Qualifier: Bristol').count(),0);
 await search.fill('brsitol');await row('2026 UK Open Blitz Qualifier: Bristol').waitFor();assert.equal(await page.evaluate(()=>fx.requests.length),1);checks.push('Typing shares an in-flight read; cancellation hides late results and the next query reuses the completed read');
 for(const width of [1100,560,390,360]){
  await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,`${width}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const help=page.getByRole('button',{name:'Help: Tournament search',exact:true});await search.focus();await help.focus();await page.getByRole('tooltip').waitFor();const bounds=await page.getByRole('tooltip').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);await page.keyboard.press('Escape');
 }
 checks.push('1100/560/390/360px layout and keyboard help fit the viewport');
 await search.fill('https://chess-results.com/tnr2.aspx');await page.getByRole('button',{name:'Open tournament link',exact:true}).click();checks.push('Direct links still work');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={product:sibling?'En Croissant':'Novelty',surface:phone?'phone':'desktop',origin:liveOrigin??'isolated fixture server',source:'actual components with synthetic source responses',checks,errors,external};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')});console.error(JSON.stringify({checks,errors,state:await page.evaluate(()=>({requests:window.fx?.requests,body:document.body.innerText}))}));}throw error;}
finally{await browser?.close();await server.close();}
