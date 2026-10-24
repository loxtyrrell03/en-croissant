/** Actual-panel failure isolation and recovery, with synthetic games only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] ?? '.');
const out = resolve(root, 'tmp/performance-errors-qa');
const sourceNames = ['truePerformance.ts', 'performanceNumerics.ts', 'performanceDynamics.ts', 'TruePerformancePanel.tsx', 'truePerformanceProtocol.ts', 'truePerformance.worker.ts', 'truePerformanceClient.ts', 'usePerformanceCalculation.ts', 'performanceDynamics.LICENSE.txt'];
async function hashes() {
  const result = {};
  for (const name of sourceNames) {
    try { result[name] = createHash('sha256').update(await readFile(resolve(root, 'src/shared', name))).digest('hex'); }
    catch (e) { if (name !== 'performanceDynamics.ts' || e.code !== 'ENOENT') throw e; }
  }
  return result;
}
const initialHashes = await hashes();
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'entry.tsx'), `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TruePerformancePanel} from '/src/shared/TruePerformancePanel';
const NativeWorker=window.Worker;
window.workerRecords=[];
window.Worker=class extends NativeWorker {
  constructor(...args) { super(...args); this.record={terminated:false}; window.workerRecords.push(this.record); this.addEventListener('message',event=>{this.record.response=event.data.result?.status;}); }
  postMessage(request) { Object.assign(this.record,{id:request.id,kind:request.kind,count:request.games.length}); return super.postMessage(request); }
  terminate() { this.record.terminated=true; return super.terminate(); }
};
const now=1700010000;
function Fixture() {
  const [mode,setMode]=useState(new URLSearchParams(location.search).get('mode'));
  window.recover=()=>setMode('normal');
  const games=Array.from({length:10},(_,i)=>({id:'normal'+i,pool:'synthetic:blitz',at:now-100+i,rating:1500,opponentRating:1550,opponentSd:mode==='both'?5000:60,score:[1,.5,0][i%3],white:i%2===0,opponent:'Synthetic opponent',rated:true}));
  if(mode==='history') games.unshift({...games[0],id:'old-unsupported',at:now-40*86400,opponentSd:5000});
  return <TruePerformancePanel games={games} poolLabel="Synthetic test pool" period="30d" asOf={now}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
await writeFile(resolve(out, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#141416;color:#e8e8ea;font-family:Segoe UI,sans-serif"><main id="root" style="padding:16px;box-sizing:border-box;max-width:1100px;margin:auto"></main><script type="module" src="/tmp/performance-errors-qa/entry.tsx"></script></body></html>');
await build({ root, configFile:false, plugins:[react()], logLevel:'warn', build:{ outDir:resolve(out,'bundle'), emptyOutDir:false, copyPublicDir:false, rollupOptions:{input:resolve(out,'index.html')} } });
const server = await preview({root,configFile:false,build:{outDir:resolve(out,'bundle')},preview:{port:0,host:'127.0.0.1'}});
const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
page.setDefaultTimeout(120000);
const errors=[],external=[],unexpectedConsole=[],cases=[],diagnostics=[],retryChecks=[];
let expectedCalculationErrors=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{
  if(message.type()!=='error') return;
  if(message.text().startsWith('Performance estimate could not be calculated')) { expectedCalculationErrors++; diagnostics.push(message.text()); }
  else unexpectedConsole.push(message.text());
});
await page.route('**/*',route=>{
  if(new URL(route.request().url()).origin===origin) return route.continue();
  external.push(route.request().url()); return route.abort();
});
try {
  for(const width of [1100,390]) for(const mode of ['both','history']) {
    await page.setViewportSize({width,height:1000});
    await page.goto(origin+'/tmp/performance-errors-qa/index.html?mode='+mode);
    const results=page.getByLabel('Game results');
    await results.waitFor();
    assert((await results.innerText()).includes('Wins'));
    const hero=page.locator('[class*="heroRating"]');
    if(mode==='both') {
      await page.getByText('This estimate could not be calculated reliably for these games.',{exact:true}).waitFor();
      assert(await hero.count() === 0 || !/^\d/.test(await hero.innerText()),'Failed estimate is presented as a number');
      assert(!(await page.locator('body').innerText()).includes('The starting account rating is missing.'));
    } else {
      await page.waitForFunction(() => /^\d/.test(document.querySelector('[class*="heroRating"]')?.textContent ?? ''));
      await page.getByRole('img', { name: 'Performance rating over selected games', exact: true }).waitFor();
      assert(/^\d/.test(await hero.innerText()),'Valid period estimate was lost with the longer history');
      assert(await page.locator('svg polyline').count()>0,'Valid period chart was lost');
    }
    await page.getByRole('button',{name:'Compare ratings',exact:true}).click();
    await page.getByText('Running-strength estimate unavailable',{exact:true}).waitFor();
    await page.getByLabel('Rating graph').selectOption('history');
    await page.getByText('This estimate could not be calculated reliably for these games. Your game results are still shown below.',{exact:true}).waitFor();
    assert.equal(await page.locator('svg polyline').count(),0,'Failed history retained a stale chart');
    // Exercise each actual Retry button once. Record worker identity rather
    // than relying on transient loading text from these deliberately fast errors.
    if(width===1100) {
      const kind=mode==='both'?'period':'history';
      const beforeRecords=await page.evaluate(()=>window.workerRecords);
      const previous=beforeRecords.filter(record=>record.kind===kind).at(-1);
      assert(previous?.terminated&&previous.response==='error','Retry did not start from a finished failure');
      const resultsBefore=await results.innerText();
      const validPeriodBefore=mode==='history'?await hero.innerText():null;
      await page.getByRole('button',{name:kind==='period'?'Retry performance estimate':'Retry playing-strength history',exact:true}).click();
      assert.equal(await results.innerText(),resultsBefore,'Retry removed game results');
      await page.waitForFunction(({count,kind})=>{
        const records=window.workerRecords, latest=records.at(-1);
        return records.length>count&&latest.kind===kind&&latest.response==='error'&&latest.terminated;
      },{count:beforeRecords.length,kind});
      const afterRecords=await page.evaluate(()=>window.workerRecords);
      assert.equal(afterRecords.length,beforeRecords.length+1,'Retry duplicated or replaced an unrelated calculation');
      const retried=afterRecords.at(-1);
      assert.notEqual(retried.id,previous.id,'Retry reused the failed worker request');
      assert.deepEqual(afterRecords.slice(0,-1),beforeRecords,'Retry changed another worker attempt');
      assert.equal(await results.innerText(),resultsBefore,'Retry failure removed game results');
      if(kind==='period') {
        await page.getByText('This estimate could not be calculated reliably for these games.',{exact:true}).waitFor();
        assert(await hero.count()===0||!/^\d/.test(await hero.innerText()),'Failed retry produced a rating');
      } else {
        await page.getByText('This estimate could not be calculated reliably for these games. Your game results are still shown below.',{exact:true}).waitFor();
        assert.equal(await hero.innerText(),validPeriodBefore,'History retry lost the valid period estimate');
        await page.getByLabel('Rating graph').selectOption('performance');
        await page.getByRole('img',{name:'Performance rating over selected games',exact:true}).waitFor();
        assert(await page.locator('svg polyline').count()>0,'History retry lost the valid period chart');
        await page.getByLabel('Rating graph').selectOption('history');
        assert.equal(await page.locator('svg polyline').count(),0,'Failed retry retained a stale history chart');
      }
      retryChecks.push({mode,width,kind,previousId:previous.id,retryId:retried.id,newWorkerFailed:true,
        resultsPreserved:true,otherAttemptUnchanged:true,validPeriodPreserved:kind==='history'});
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:resolve(out,mode+'-'+width+'.png'),fullPage:true});
    await page.evaluate(()=>window.recover());
    await page.locator('svg polyline').first().waitFor();
    await page.waitForFunction(() => /^\d/.test(document.querySelector('[class*="heroRating"]')?.textContent ?? ''));
    assert(/^\d/.test(await hero.innerText()));
    assert(!(await page.locator('body').innerText()).includes('could not be calculated reliably'));
    assert.equal(await page.getByText('Running-strength estimate unavailable',{exact:true}).count(),0);
    cases.push({mode,width,resultsPreserved:true,independentEstimatePreserved:mode==='history',samePanelRecovered:true});
  }
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.deepEqual(unexpectedConsole,[]);
  assert.equal(expectedCalculationErrors,8);
  assert.deepEqual(retryChecks.map(check=>check.kind),['period','history']);
  assert(diagnostics.every(message => /quadrature|spread|uncertainty|support|numerical/i.test(message)), 'Solver diagnostic was lost');
  const finalHashes=await hashes(); assert.deepEqual(finalHashes,initialHashes,'Source changed during verification');
  const receipt={passed:true,scope:'Actual shared panel; synthetic unsupported opponent uncertainty, both retry actions, independent failure isolation and same-instance input recovery. No owner data, installed app or physical-device verification.',hashes:finalHashes,cases,retryChecks,expectedCalculationErrors,diagnostics,errors,external,unexpectedConsole};
  await writeFile(resolve(out,'result.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
