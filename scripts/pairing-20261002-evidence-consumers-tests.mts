/** Tiny direct consumer regressions: no model, exact solver, worker or UI import. */
import assert from 'node:assert/strict';
import {standingsAfterRound, hasPublishedStandingRanks} from '../src/features/tournaments/tournamentInsights.ts';
import {priorZeroPointAbsences, estimatedAttendance, swissParticipationScenario} from '../src/features/tournaments/swissParticipation.ts';
import {historicalTournamentSnapshot} from '../src/features/tournaments/historicalTournamentSnapshot.ts';
import {cachedTournamentEvidence} from '../src/features/tournaments/tournamentForecastEvidence.ts';
import type {EvidenceTournamentSnapshot as Snapshot} from '../src/features/tournaments/tournamentSnapshotEvidenceTypes.ts';

const began = performance.now(), groups: string[] = [];
let assertions = 0;
const eq = (a: unknown, b: unknown) => {assertions++; assert.deepEqual(a, b);};
const ok = (value: unknown) => {assertions++; assert(value);};
const test = (name: string, run: () => void) => {run(); groups.push(name);};
function fixture(): Snapshot {
  return {tournamentId:'evidence-consumer-fixture',sourceUrl:'fixture://evidence',title:'Synthetic',section:null,
    format:'swiss',formatLabel:'Swiss-System',totalRounds:4,completedRound:1,publishedRound:1,liveRound:null,nextRound:2,
    phase:'between-rounds',dateRange:null,timeControl:null,sourceUpdatedAt:null,fetchedAt:'synthetic',warnings:[],
    players:[1,2,3,4].map(startNumber=>({startNumber,name:`Player ${startNumber}`,fideId:null,federation:null,title:null,
      rating:2400-startNumber*50,rank:startNumber,points:99,active:true})),
    pairings:[{round:1,board:1,whiteStartNumber:1,blackStartNumber:2,whitePoints:777,blackPoints:777,result:'1-0',decided:true},
      {round:1,board:2,whiteStartNumber:3,blackStartNumber:4,whitePoints:777,blackPoints:777,result:'½-½',decided:true}],
    roundStandings:[],incompletePairingRounds:[]};
}
const row = (s: Snapshot, id: number, round=1) => standingsAfterRound(s,round).find(p=>p.startNumber===id)!;
const published = (s: Snapshot,id:number,points:number,round=1,rank:number|null=null) => {
  s.evidenceVersion=1; Object.assign(s.players.find(p=>p.startNumber===id)!,{points,rank,scoreKnown:true,scoreRound:round,scoreSource:'published'});
};
function solo(result: string|null='0'): Snapshot {
  const s=fixture(); s.pairings=[{...s.pairings[0],whiteStartNumber:1,blackStartNumber:null,result,decided:result!==null}];return s;
}

test('Legacy defaults/ranks/partial tables are not score authority; complete history recovers totals',()=>{
  const s=fixture(), before=structuredClone(s), rows=standingsAfterRound(s,1);
  eq(rows.map(p=>[p.startNumber,p.points,p.scoreKnown,p.rankSource]),[[1,1,true,'reconstructed'],[3,.5,true,'reconstructed'],[4,.5,true,'reconstructed'],[2,0,true,'reconstructed']]);
  eq(hasPublishedStandingRanks(rows),false); eq(s,before); eq(standingsAfterRound(s,1),rows);
  const missing=fixture(); missing.pairings.shift(); missing.players[0].notPairedRounds=[1];missing.players[1].halfPointByeRounds=[1];
  missing.roundStandings=[{round:1,players:missing.players.map(p=>({...p,points:999,rank:1}))}];
  eq(row(missing,1).scoreKnown,false);eq(row(missing,2).scoreKnown,false);eq(row(missing,3).points,.5);
  ok(standingsAfterRound(missing,1).every(p=>p.rank===null));eq(standingsAfterRound(missing,1).length,4);
});

test('Exact-scope published adjustments and ranks survive; partial ranks never invent the remainder',()=>{
  const s=fixture();published(s,1,-.5,1,4);
  eq([row(s,1).points,row(s,1).scoreKnown,row(s,1).rank,row(s,1).rankSource],[-.5,true,4,'published']);
  ok(standingsAfterRound(s,1).filter(p=>p.startNumber!==1).every(p=>p.rank===null));
  eq(hasPublishedStandingRanks(standingsAfterRound(s,1)),true);
  const table=fixture();table.evidenceVersion=1;table.pairings[1].result=null;table.pairings[1].decided=false;
  table.roundStandings=[{round:1,players:[{...table.players[2],points:0,rank:1,scoreKnown:false,scoreRound:null,scoreSource:'unknown'}]}];
  eq([row(table,3).scoreKnown,row(table,3).rank,row(table,3).rankSource],[false,1,'published']);
  eq(row(table,4).scoreKnown,false);eq(row(table,4).rank,null);eq(standingsAfterRound(table,1).length,4);
});

test('Duplicate published rows are not silently chosen; invalid numeric evidence stays unavailable',()=>{
  const s=fixture();s.evidenceVersion=1;
  const p={...s.players[0],scoreKnown:true as const,scoreRound:1,scoreSource:'published' as const,points:2,rank:2};
  s.roundStandings=[{round:1,players:[p,{...p,points:3,rank:1}]}];
  eq(row(s,1).scoreKnown,false);eq(row(s,1).rank,null);ok(standingsAfterRound(s,1).every(p=>p.rank===null));
  const invalid=fixture();published(invalid,1,NaN);eq(row(invalid,1).scoreKnown,false);
});

test('Live/final/initial display scopes never relabel prior zero as a later total',()=>{
  const live=fixture();live.completedRound=0;live.liveRound=1;live.phase='round-in-progress';live.pairings[1].result='*';live.pairings[1].decided=true;
  eq(row(live,1).points,1);eq(row(live,2).points,0);eq(row(live,2).scoreKnown,true);eq(row(live,3).scoreKnown,false);
  ok(standingsAfterRound(live,1).every(p=>p.rank===null));eq(live.completedRound,0);
  const final=fixture();final.totalRounds=1;final.phase='complete';final.nextRound=null;
  ok(standingsAfterRound(final,1).every(p=>p.scoreKnown));
  eq(standingsAfterRound(fixture(),0).map(p=>p.points),[0,0,0,0]);
  const opening=fixture();opening.completedRound=0;opening.publishedRound=0;opening.pairings=[];
  ok(standingsAfterRound(opening,1).every(p=>!p.scoreKnown));
});

test('Future score/rank/table poison cannot alter an earlier displayed standing',()=>{
  const baseline=fixture();baseline.evidenceVersion=1;
  const poison=structuredClone(baseline);poison.roundStandings=[{round:99,players:null as any}];
  poison.players.forEach(p=>Object.assign(p,{points:NaN,rank:123,scoreKnown:true,scoreRound:99,scoreSource:'invalid'}));
  eq(standingsAfterRound(poison,1),standingsAfterRound(baseline,1));
});

test('Only explicit zero solo/status awards contribute to absence; legacy hints and late entry do not',()=>{
  for(const result of ['0','0-0'])eq(priorZeroPointAbsences(solo(result),1,2),1);
  for(const result of [null,'','*','?','1','½'])eq(priorZeroPointAbsences(solo(result),1,2),0);
  const legacy=fixture();legacy.pairings=[];legacy.players[0].notPairedRounds=[1];eq(priorZeroPointAbsences(legacy,1,2),0);
  for(const [version,kind,award,expected]of [[1,'not-paired',0,1],[undefined,'not-paired',0,0],[2,'not-paired',0,0],
    [1,'not-paired',null,0],[1,'not-paired',.5,0],[1,'not-yet-entered',0,0]]as const){
    const s=fixture();s.pairings=[];s.evidenceVersion=version;s.roundStatus=[{round:1,startNumber:1,kind,award}];
    eq(priorZeroPointAbsences(s,1,2),expected);
  }
  const hint=solo();hint.players[0].halfPointByeRounds=[1];eq(priorZeroPointAbsences(hint,1,2),1);
});

test('Conflict/incomplete coverage stops absence streaks; future information is ignored and returns remain possible',()=>{
  const conflict=solo();conflict.pairings.push({...conflict.pairings[0],board:2});eq(priorZeroPointAbsences(conflict,1,2),0);
  const incomplete=solo();incomplete.incompletePairingRounds=[1];eq(priorZeroPointAbsences(incomplete,1,2),0);
  const s=solo();const before=structuredClone(s),scenario=swissParticipationScenario(s,2);
  eq(s,before);eq(s.players[0].active,true);eq(scenario.players[0].active,false);
  ok(estimatedAttendance(s,1,2)>0);ok(estimatedAttendance(s,1,2)<1);eq(swissParticipationScenario(scenario,2),scenario);
  const returned=solo();returned.completedRound=2;returned.pairings.push({...returned.pairings[0],round:2,blackStartNumber:2,result:null,decided:false});
  eq(priorZeroPointAbsences(returned,1,3),0);eq(estimatedAttendance(returned,1,3),1);
  const future=solo();future.evidenceVersion=1;future.roundStatus=[{round:99,startNumber:1,kind:'invalid',award:99}as any];
  future.roundCoverage=[{round:99,pairingPage:'invalid'}as any];eq(priorZeroPointAbsences(future,1,2),1);
  const repeated=solo();repeated.pairings.push({...repeated.pairings[0],round:2});
  eq(priorZeroPointAbsences(repeated,1,3),2);ok(estimatedAttendance(repeated,1,3)>0);
});

test('Backcast reconstructs scoped legacy totals instead of attaching future evidence to synthetic zero',()=>{
  const s=fixture();s.completedRound=3;s.publishedRound=3;s.nextRound=4;s.players.forEach(p=>{p.active=false;p.notPairedRounds=[2,3,99];p.halfPointByeRounds=[2,3,99];});
  const before=structuredClone(s),backcast=historicalTournamentSnapshot(s,2)!;
  ok(backcast);eq(backcast.players.map(p=>p.points),[1,0,.5,.5]);
  ok(backcast.players.every(p=>p.scoreKnown&&p.scoreRound===1&&p.scoreSource==='reconstructed'&&p.rank===null&&p.active));
  ok(backcast.players.every(p=>p.notPairedRounds?.length===0&&p.halfPointByeRounds?.length===0));
  eq(backcast.completedRound,1);eq(backcast.nextRound,2);eq(backcast.evidenceVersion,1);eq(s,before);
});

test('Backcasts keep historical published adjustments but slice all target/future evidence',()=>{
  const baseline=fixture();published(baseline,1,.25,1,1);
  baseline.roundStandings=[{round:1,players:[{...baseline.players[0]}]}];
  baseline.roundStatus=[];baseline.roundCoverage=[];
  const poison=structuredClone(baseline);poison.completedRound=3;poison.publishedRound=3;poison.nextRound=4;
  poison.players.forEach(p=>Object.assign(p,{points:NaN,rank:123,scoreKnown:true,scoreRound:3,scoreSource:'invalid',active:false,notPairedRounds:[2,3,99],halfPointByeRounds:[2,3,99]}));
  poison.pairings.push({...poison.pairings[0],round:2,result:'0-1'},{...poison.pairings[1],round:3,result:'unknown'});
  poison.roundStandings!.push({round:2,players:null as any},{round:99,players:null as any});
  poison.roundStatus=[{round:2,startNumber:1,kind:'invalid',award:99}as any];
  poison.roundCoverage=[{round:2,pairingPage:'invalid'}as any];poison.incompletePairingRounds=[2,3,99];
  const expected=historicalTournamentSnapshot(baseline,2)!,actual=historicalTournamentSnapshot(poison,2)!;
  ok(actual);eq(actual.players[0].points,.25);eq(actual.players[0].scoreSource,'published');eq(actual,expected);
});

test('Backcasts preserve strict prior status/coverage and refuse unrecoverable history',()=>{
  const s=fixture();s.evidenceVersion=1;s.pairings.shift();s.roundStatus=[{round:1,startNumber:1,kind:'not-paired',award:0},
    {round:1,startNumber:2,kind:'not-yet-entered',award:0}];
  s.roundCoverage=[{round:1,pairingPage:'readable',statusPage:'readable',unresolvedRows:0,duplicateStartNumbers:[],unaccountedStartNumbers:[]}];
  const backcast=historicalTournamentSnapshot(s,2)!;ok(backcast);eq(backcast.roundStatus,s.roundStatus);eq(backcast.roundCoverage,s.roundCoverage);
  eq(backcast.players[0].points,0);eq(backcast.players[0].scoreKnown,true);eq(priorZeroPointAbsences(backcast,1,2),1);eq(priorZeroPointAbsences(backcast,2,2),0);
  for(const change of [(p:Snapshot)=>{p.pairings.shift();},(p:Snapshot)=>{p.pairings[0].result=null;p.pairings[0].decided=false;},
    (p:Snapshot)=>{p.incompletePairingRounds=[1];},(p:Snapshot)=>{p.evidenceVersion=1;p.roundCoverage=[{round:1,pairingPage:'readable',statusPage:'unavailable',unresolvedRows:1,duplicateStartNumbers:[],unaccountedStartNumbers:[]}];}]){
    const bad=fixture();change(bad);eq(historicalTournamentSnapshot(bad,2),null);
  }
});

test('Invalid/unbounded resolution refuses without allocating a huge history or inventing zeros',()=>{
  const s=fixture();s.totalRounds=0;
  eq(cachedTournamentEvidence(s,1_000_000_000),null);
  ok(standingsAfterRound(s,1_000_000_000).every(p=>!p.scoreKnown&&p.rank===null));
  eq(priorZeroPointAbsences(s,1,1_000_000_000),0);eq(historicalTournamentSnapshot(s,1_000_000_000),null);
  const hugePublished=structuredClone(s);published(hugePublished,1,1,1_000_000_000,1);
  ok(standingsAfterRound(hugePublished,1_000_000_000).every(p=>!p.scoreKnown&&p.rank===null));
  const invalid=fixture();invalid.players[0].startNumber=0;
  ok(standingsAfterRound(invalid,1).every(p=>!p.scoreKnown));eq(historicalTournamentSnapshot(invalid,2),null);
});

console.log(JSON.stringify({passed:true,groups:groups.length,assertions,elapsedMs:performance.now()-began,checks:groups,
  scope:'Injected tiny evidence/standings/attendance/backcast consumers only; no model/solver/worker/UI or source-data access'}));
