import { afterEach, describe, expect, test, vi } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";

const state=vi.hoisted(()=>({snapshots:[] as TournamentSnapshot[], failedSnapshot:null as TournamentSnapshot|null, failOne:false}));
vi.mock('../exactSwissForecast.ts',()=>({swissPairingSystemFor:()=>"dutch",calculateExactSwissForecast:(s:TournamentSnapshot,round:number,player:number,system:string)=>{
  state.snapshots.push(s);
  const complete=s.pairings.filter(p=>p.round<round).every(p=>p.decided);
  if(complete&&state.failOne&&!state.failedSnapshot) state.failedSnapshot=s;
  if(s===state.failedSnapshot)return null;
  const alternate=complete&&s.pairings[2].result!=='1-0';
  const pairs=alternate?[[1,3],[2,6],[4,5]]:[[1,2],[3,4],[5,6]];
  const pair=pairs.find(p=>p.includes(player));
  if(!pair)return null;
  return {opponentStartNumber:pair[0]===player?pair[1]:pair[0],color:pair[0]===player?'white':'black',system,acceleration:null,estimatedLiveResults:!complete};
}}));
import {calculateSampledSwissForecast} from '../sampledSwissForecast';
import {calibratedRankProbabilities} from '../pairingCalibration';

function snapshot():TournamentSnapshot {
  return {tournamentId:'synthetic-sampling',title:'Swiss',formatLabel:'Swiss',format:'swiss',totalRounds:5,liveRound:1,
    completedRound:0,publishedRound:1,nextRound:2,phase:'round-in-progress',sourceUrl:'fixture://sampling',section:null,
    dateRange:null,timeControl:null,sourceUpdatedAt:null,fetchedAt:'synthetic',warnings:[],
    players:Array.from({length:6},(_,i)=>({startNumber:i+1,name:`Player ${i+1}`,fideId:null,federation:null,title:null,rating:i<3?2000:null,rank:i+1,points:0,active:true})),
    pairings:[[1,4],[2,5],[3,6]].map(([whiteStartNumber,blackStartNumber],i)=>({round:1,board:i+1,whiteStartNumber,blackStartNumber,result:i<2?'1-0':null,decided:i<2,whitePoints:null,blackPoints:null})),
  } as TournamentSnapshot;
}
afterEach(()=>{state.snapshots=[];state.failedSnapshot=null;state.failOne=false;vi.unstubAllGlobals();});

describe('coherent Swiss outcome sampling',()=>{
  test('completes whole boards without changing known results or the input, and reuses one ensemble for every player',()=>{
    const s=snapshot(),original=structuredClone(s);
    const first=calculateSampledSwissForecast(s,2,1);
    expect(first?.sampling).toEqual({samples:16,successful:16});
    const samples=[...new Set(state.snapshots)].filter(p=>p.pairings.every(game=>game.decided));
    expect(samples).toHaveLength(16);
    for(const sample of samples) {
      expect(sample.pairings[0]).toEqual(original.pairings[0]);
      expect(sample.pairings.every(p=>p.decided)).toBe(true);
      expect(sample.pairings.every(p=>['1-0','1/2-1/2','0-1'].includes(p.result!))).toBe(true);
    }
    expect(s).toEqual(original);
    calculateSampledSwissForecast(s,2,2);
    expect(new Set(state.snapshots).size).toBe(17);
  });
  test('legacy unknown result flags are sampled, and raw placeholders do not change scenario seeds',()=>{
    const reference=snapshot(),legacy=structuredClone(reference);
    legacy.pairings[2]={...legacy.pairings[2],result:'*',decided:true};
    const first=calculateSampledSwissForecast(reference,2,1);
    const firstSamples=[...new Set(state.snapshots)].filter(s=>s.pairings.every(p=>p.decided)).map(s=>s.pairings);
    state.snapshots=[];
    const corrected=calculateSampledSwissForecast(legacy,2,1);
    expect(corrected).toEqual(first);
    expect(corrected?.sampling).toEqual({samples:16,successful:16});
    const secondSamples=[...new Set(state.snapshots)].filter(s=>s.pairings.every(p=>p.decided)).map(s=>s.pairings);
    expect(secondSamples).toEqual(firstSamples);
    expect(legacy.pairings[2]).toMatchObject({result:'*',decided:true});
  });
  test('does not condition probabilities on a selectively successful ensemble',()=>{
    state.failOne=true;
    const f=calculateSampledSwissForecast(snapshot(),2,1);
    expect(f?.opponentStartNumber).toBe(2);
    expect(f?.sampling).toBeUndefined();
  });
  test('future results and refresh timestamps do not influence the sampled outcome sequence',()=>{
    const a=snapshot(),b=structuredClone(a);
    b.fetchedAt='future-refresh';b.players[0].notPairedRounds=[99];b.players[0].halfPointByeRounds=[99];b.pairings.push({...b.pairings[0],round:5,result:'0-1'});
    const first=calculateSampledSwissForecast(a,2,1),second=calculateSampledSwissForecast(b,2,1);
    expect(second).toEqual(first);
    const samples=[...new Set(state.snapshots)].filter(p=>p.pairings.filter(game=>game.round===1).every(game=>game.decided));
    expect(samples.slice(0,16).map(s=>s.pairings.filter(p=>p.round===1))).toEqual(samples.slice(16).map(s=>s.pairings.filter(p=>p.round===1)));
  });
  test('requires a strict majority of current-round results and complete earlier history',()=>{
    const early=snapshot();early.pairings[1].decided=false;early.pairings[1].result=null;
    expect(calculateSampledSwissForecast(early,2,1)?.sampling).toBeUndefined();
    const hole=snapshot();hole.completedRound=1;hole.publishedRound=2;hole.liveRound=2;hole.nextRound=3;
    hole.pairings.push(...hole.pairings.map(game=>({...game,round:2})));
    const calls=state.snapshots.length;
    expect(calculateSampledSwissForecast(hole,3,1)).toBeNull();
    expect(state.snapshots).toHaveLength(calls);
  });
  test('retains the original reconstruction outside validated size/system/live scope',()=>{
    const base=snapshot();base.liveRound=null;base.completedRound=1;base.phase='between-rounds';
    base.pairings[2]={...base.pairings[2],result:'1/2-1/2',decided:true};
    expect(calculateSampledSwissForecast(base,2,1)?.sampling).toBeUndefined();
    const large=snapshot();large.players=Array.from({length:121},(_,i)=>({...large.players[0],startNumber:i+1}));
    for(let player=7;player<=121;player+=2)large.pairings.push({round:1,board:large.pairings.length+1,
      whiteStartNumber:player,blackStartNumber:player===121?null:player+1,whitePoints:0,blackPoints:player===121?null:0,
      result:player===121?'1/2':'1/2-1/2',decided:true});
    expect(calculateSampledSwissForecast(large,2,1)?.sampling).toBeUndefined();
    expect(calculateSampledSwissForecast(snapshot(),2,1,'dubov')?.sampling).toBeUndefined();
    expect(state.snapshots).toHaveLength(3);
  });
  test('fitted probability interpolation is finite, monotone and retains Other mass',()=>{
    for(const fraction of [null,0,.01,.125,.25,.5,.75,.9,.99,1]) {
      const p=calibratedRankProbabilities(true,2,fraction);
      expect(p).toHaveLength(6);
      expect(p.every((v,i)=>Number.isFinite(v)&&v>0&&(i===0||v<=p[i-1]))).toBe(true);
      expect(p.reduce((a,b)=>a+b,0)).toBeLessThan(1);
    }
  });
});


test("the actual worker entry point returns sampled evidence for an eligible live request",async()=>{
  let onMessage!: (event: {data: Record<string,unknown>})=>void;
  const postMessage=vi.fn();
  vi.stubGlobal("self",{addEventListener:(_type:string,listener:typeof onMessage)=>{onMessage=listener;},postMessage});
  await import("../exactSwissForecast.worker");
  onMessage({data:{id:81,snapshot:snapshot(),targetRound:2,myStartNumber:1,system:"dutch"}});
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({id:81,forecasts:expect.objectContaining({1:expect.objectContaining({sampling:{samples:16,successful:16}})})}));
  const response=postMessage.mock.calls[0][0];
  expect(Object.keys(response.forecasts)).toHaveLength(6);
});
