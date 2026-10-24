/** Actual module workers and React lifecycle, synthetic inputs, no owner data. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] ?? '.');
const out = resolve(root, 'tmp/performance-async-qa');
const names = ['truePerformance.ts', 'performanceNumerics.ts', 'performanceDynamics.ts', 'TruePerformancePanel.tsx', 'truePerformanceProtocol.ts', 'truePerformance.worker.ts', 'truePerformanceClient.ts', 'usePerformanceCalculation.ts', 'performanceDynamics.LICENSE.txt'];
async function hashes() {
  const result = {};
  for (const name of names) result[name] = createHash('sha256').update(await readFile(resolve(root, 'src/shared', name))).digest('hex');
  return result;
}
const initialHashes = await hashes();
const externalPeriod = (await readFile(resolve(root, 'src/shared/TruePerformancePanel.tsx'), 'utf8')).includes('period?: PerformancePeriod');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'entry.tsx'), `
import React, {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TruePerformancePanel} from '/src/shared/TruePerformancePanel';
const NativeWorker=window.Worker;
window.workerRecords=[];
window.Worker=class extends NativeWorker {
  constructor(...args) { super(...args); this.record={terminated:false}; window.workerRecords.push(this.record); this.addEventListener('message',event=>{this.record.response=event.data.result?.status;}); }
  postMessage(request) { Object.assign(this.record,{id:request.id,kind:request.kind,count:request.games.length}); return super.postMessage(request); }
  terminate() { this.record.terminated=true; return super.terminate(); }
};
const now=Date.now()/1000;
function Fixture() {
  const [large,setLarge]=useState(false),[mounted,setMounted]=useState(true),[period,setPeriod]=useState('all');
  const games=useMemo(()=>Array.from({length:large?5000:8},(_,i)=>({id:(large?'long':'small')+i,pool:large?'synthetic:long:blitz':'synthetic:small:blitz',at:now-10000+i,rating:large?1500:1900,opponentRating:large?1550+(i*137)%500:1900,opponentSd:60,score:[1,.5,0,1,0][i%5],white:i%2===0,opponent:'Synthetic opponent',rated:true})),[large]);
  window.useLarge=()=>flushSync(()=>setLarge(true));
  window.useSmall=()=>flushSync(()=>setLarge(false));
  window.unmountPanel=()=>flushSync(()=>setMounted(false));
  window.remountPanel=()=>flushSync(()=>{setLarge(false);setMounted(true);});
  return <><button onClick={()=>setLarge(v=>!v)}>Change sample</button>{mounted&&<TruePerformancePanel games={games} period={period} poolLabel={large?'Large sample':'Small sample'} controls={${externalPeriod ? `<label>Choose your games<select aria-label="Performance period" value={period} onChange={event=>setPeriod(event.target.value)}><option value="all">All games</option><option value="50g">Last 50 games</option></select></label>` : 'null'}}/>}</>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
await writeFile(resolve(out, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#141416;color:#e8e8ea;font-family:Segoe UI,sans-serif"><main id="root" style="padding:16px;box-sizing:border-box;max-width:1100px;margin:auto"></main><script type="module" src="/tmp/performance-async-qa/entry.tsx"></script></body></html>');
await build({ root, configFile:false, plugins:[react()], logLevel:'warn', build:{ outDir:resolve(out,'bundle'), emptyOutDir:false, copyPublicDir:false, rollupOptions:{ input:resolve(out,'index.html') } } });
const server=await preview({ root, configFile:false, build:{outDir:resolve(out,'bundle')}, preview:{port:0,host:'127.0.0.1'} });
const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:900}});
page.setDefaultTimeout(120000);
const errors=[],external=[],consoleErrors=[];
page.on('pageerror', error=>errors.push(error.message));
page.on('console', message=>{if(message.type()==='error') consoleErrors.push(message.text());});
await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
const ready=()=>page.waitForFunction(()=>window.workerRecords.length>=2&&window.workerRecords.every(record=>record.terminated));
try {
  await page.goto(origin+'/tmp/performance-async-qa/index.html');
  await ready();
  await page.getByRole('img',{name:'Performance rating over selected games',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.workerRecords.length),2,'Initial panel duplicated a calculation');
  // A completion, comparison toggle and browser clock advancement must not change omitted asOf.
  await page.getByRole('button',{name:'Compare ratings',exact:true}).click();
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>window.workerRecords.length),2,'Omitted asOf restarted on rerender');
  const previousRating=await page.locator('[class*="heroRating"]').innerText();
  const immediate=await page.evaluate(()=>{window.useLarge();return {hero:document.querySelector('[class*="heroRating"]')?.textContent??'',chart:!!document.querySelector('svg polyline')};});
  assert(!/^\d/.test(immediate.hero)&&!immediate.chart,'Changed account exposed stale estimates during render');
  await page.waitForFunction(()=>window.workerRecords.filter(record=>record.count===5000&&!record.terminated).length===2);
  const largeIds=await page.evaluate(()=>window.workerRecords.filter(record=>!record.terminated).map(record=>record.id));
  const started=performance.now();
  await page.getByLabel('Rating graph').selectOption('history');
  await page.getByLabel('Performance period').selectOption('50g');
  const controlsMs=performance.now()-started;
  assert(controlsMs<1500,`Controls blocked for ${controlsMs} ms during a 5000-game calculation`);
  await page.waitForFunction(()=>window.workerRecords.some(record=>record.kind==='period'&&record.count===50));
  const afterPeriod=await page.evaluate(()=>window.workerRecords);
  assert(afterPeriod.find(record=>record.id===largeIds.find(id=>afterPeriod.find(record=>record.id===id)?.kind==='period')).terminated,'Obsolete period worker stayed alive');
  assert.equal(afterPeriod.filter(record=>record.kind==='history').length,2,'Changing period duplicated full history');
  const smallImmediate=await page.evaluate(()=>{window.useSmall();return {hero:document.querySelector('[class*="heroRating"]')?.textContent??'',chart:!!document.querySelector('svg polyline')};});
  assert(!/^\d/.test(smallImmediate.hero)&&!smallImmediate.chart,'Replacement input retained a stale estimate');
  await ready();
  await page.getByRole('img',{name:'Estimated playing strength over selected games',exact:true}).waitFor();
  assert.equal(await page.locator('[class*="heroRating"]').innerText(),previousRating);
  const beforeUnmount=await page.evaluate(()=>{window.useLarge();return window.workerRecords.length;});
  await page.waitForFunction(count=>window.workerRecords.length>=count&&window.workerRecords.filter(record=>!record.terminated).length===2,beforeUnmount);
  const unmounted=await page.evaluate(()=>{window.unmountPanel();return {active:window.workerRecords.filter(record=>!record.terminated).length,panel:!!document.querySelector('section')};});
  assert.deepEqual(unmounted,{active:0,panel:false},'Unmount did not stop active calculations');
  await page.evaluate(()=>window.remountPanel());
  await ready();
  await page.getByRole('img',{name:'Performance rating over selected games',exact:true}).waitFor();
  assert.equal(await page.locator('[class*="heroRating"]').innerText(),previousRating);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const records=await page.evaluate(()=>window.workerRecords);
  assert(records.every(record=>record.terminated),'A finished panel leaked a worker');
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(external,[]);
  const finalHashes=await hashes();assert.deepEqual(finalHashes,initialHashes,'Source changed during verification');
  await page.screenshot({path:resolve(out,'recovered-390.png'),fullPage:true});
  const receipt={passed:true,scope:'Actual module workers with synthetic 5000-game cancellation, changed-input render masking, independent period replacement, stable omitted asOf, unmount/remount cleanup. PC headless browser only.',hashes:finalHashes,controlsMs,previousRating,records,errors,consoleErrors,external};
  await writeFile(resolve(out,'result.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
