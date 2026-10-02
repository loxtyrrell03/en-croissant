import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { hasUnknownPriorPairingResults, UNKNOWN_PRIOR_RESULTS_HELP } from "../pairingHistoryCompleteness";
import { calculatePairingForecast } from "../pairingForecast";
import { calculateExactSwissForecast } from "../exactSwissForecast";
import { calculateSampledSwissForecast } from "../sampledSwissForecast";
import { historicalPairingReliability } from "../pairingHistoryReliability";
import { pairingEstimateHelp } from "../pairingScoreHelp";
import { standingsAfterRound } from "../tournamentInsights";
import { forecastEvidenceHelp, prepareTournamentForecastEvidence } from "../tournamentForecastEvidence";

function fixture(): TournamentSnapshot {
  const points=[1,0,.5,1,0,1,.5,0];
  const players=Array.from({length:8},(_,i)=>({startNumber:i+1,name:`Player ${i+1}`,fideId:null,federation:null,title:null,rating:2400-i*65,rank:i+1,points:points[i],active:true,notPairedRounds:[],halfPointByeRounds:[]}));
  return {tournamentId:"prior-results",sourceUrl:"fixture://prior-results",title:"Synthetic Swiss",section:null,format:"swiss",formatLabel:"Swiss-System",totalRounds:5,completedRound:1,publishedRound:1,liveRound:null,nextRound:2,phase:"between-rounds",dateRange:null,timeControl:null,sourceUpdatedAt:null,fetchedAt:"synthetic",warnings:[],incompletePairingRounds:[],roundStandings:[{round:1,players:structuredClone(players)}],players,pairings:["1-0","0-1","½-½","1-0"].map((result,i)=>({round:1,board:i+1,whiteStartNumber:i+1,blackStartNumber:i+5,whitePoints:0,blackPoints:0,result,decided:true}))};
}

describe("unavailable historical results", () => {
  test("past named unknown variants abstain identically without exposing hidden valid results", () => {
    const unknown=fixture();unknown.pairings[0]={...unknown.pairings[0],result:null,decided:false};
    const control=calculatePairingForecast(unknown,1,{exactSwiss:null});
    for(const [result,decided] of [[null,false],["1F-unknown",true],["unknown-1F",true],["+pending",true],["1-0",false],["0-1",false]] as const) {
      const source=fixture();source.pairings[0]={...source.pairings[0],result,decided};
      const before=structuredClone(source),actual=calculatePairingForecast(source,1,{exactSwiss:{opponentStartNumber:8,color:"white",estimatedLiveResults:false,system:"dutch",acceleration:null}});
      expect(hasUnknownPriorPairingResults(source,2)).toBe(true);
      expect(actual).toEqual(control);
      expect(actual.candidates.length>0).toBe(true);
      expect(actual.candidates.every(candidate=>candidate.probability===null)).toBe(true);
      expect(actual.otherProbability).toBeNull();expect(actual.confidence).toBe("unavailable");
      expect(actual.caveat).toBe(forecastEvidenceHelp("unknown-results"));expect(pairingEstimateHelp(source,actual)).toBe(UNKNOWN_PRIOR_RESULTS_HELP);
      expect(calculateExactSwissForecast(source,2,1)).toBeNull();expect(calculateSampledSwissForecast(source,2,1)).toBeNull();
      expect(historicalPairingReliability({...source,nextRound:3},3)).toBeUndefined();
      expect(source).toEqual(before);
    }
  });
  test("only the immediate unfinished live named round retains normal uncertainty", () => {
    const source=fixture();Object.assign(source,{completedRound:0,liveRound:1,phase:"round-in-progress"});source.roundStandings=[];source.players=source.players.map(p=>({...p,points:0,rank:null}));source.pairings[0]={...source.pairings[0],result:null,decided:false};
    const control=calculatePairingForecast(source,1);
    expect(hasUnknownPriorPairingResults(source,2)).toBe(false);expect(control.candidates.every(c=>typeof c.probability==="number")).toBe(true);
    for(const [result,decided] of [["1F-unknown",true],["1-0",false]] as const) {
      const changed={...source,pairings:source.pairings.map((p,i)=>i===0?{...p,result,decided}:p)};
      expect(calculatePairingForecast(changed,1)).toEqual(control);
    }
    expect(hasUnknownPriorPairingResults({...source,completedRound:1},2)).toBe(true);
    expect(hasUnknownPriorPairingResults({...source,liveRound:2,nextRound:3},3)).toBe(true);
    expect(hasUnknownPriorPairingResults({...source,liveRound:null},2)).toBe(true);
  });
  test("unknown prior solo scores abstain, while explicit legacy awards stay known in either seat", () => {
    for(const black of [false,true]) for(const result of [null,"-","0","½","1"]) {
      const source=fixture();Object.assign(source,{completedRound:0,liveRound:1,phase:"round-in-progress"});source.pairings[0]={...source.pairings[0],whiteStartNumber:black?null:1,blackStartNumber:black?1:null,result,decided:false};
      // Splitting the original 1-v-5 row must still account for player 5.
      source.pairings.push({...source.pairings[0],board:5,whiteStartNumber:5,blackStartNumber:null,result:"0",decided:false});
      const unknown=result===null||result==="-";
      expect(hasUnknownPriorPairingResults(source,2)).toBe(unknown);
      const forecast=calculatePairingForecast(source,1);
      expect(forecast.candidates.length>0).toBe(true);
      expect(forecast.candidates.every(c=>unknown?c.probability===null:typeof c.probability==="number")).toBe(true);
      if(unknown){expect(calculateExactSwissForecast(source,2,1)).toBeNull();expect(calculateSampledSwissForecast(source,2,1)).toBeNull();}
    }
  });
  test("a known solo award cannot hide the displaced opponent's missing assignment", () => {
    for(const black of [false,true]) {
      const source=fixture();Object.assign(source,{completedRound:0,liveRound:1,phase:"round-in-progress"});
      source.pairings[0]={...source.pairings[0],whiteStartNumber:black?null:1,blackStartNumber:black?1:null,result:"½",decided:false};
      expect(prepareTournamentForecastEvidence(source,2).issue).toBe("incomplete-history");
      const forecast=calculatePairingForecast(source,1);
      expect(forecast.candidates.length>0).toBe(true);
      expect(forecast.candidates.every(candidate=>candidate.probability===null)).toBe(true);
      expect(forecast.otherProbability).toBeNull();
      expect(calculateExactSwissForecast(source,2,1)).toBeNull();expect(calculateSampledSwissForecast(source,2,1)).toBeNull();
    }
  });
  test("published targets, completion and future-only missing results retain precedence", () => {
    const source=fixture();source.pairings[0]={...source.pairings[0],result:null,decided:false};
    const published={...source,pairings:[...source.pairings,{...source.pairings[0],round:2,blackStartNumber:8}]};
    expect(calculatePairingForecast(published,1)).toMatchObject({kind:"confirmed",candidates:[{player:{startNumber:8},probability:1}]});
    const solo={...published,pairings:published.pairings.map(p=>p.round===2?{...p,blackStartNumber:null,result:"0"}:p)};
    expect(calculatePairingForecast(solo,1).kind).toBe("confirmed");
    expect(calculatePairingForecast({...source,phase:"complete",totalRounds:1,nextRound:null},1).kind).toBe("complete");
    const later=fixture();later.pairings.push({...later.pairings[0],round:3,result:null,decided:false});
    expect(hasUnknownPriorPairingResults(later,2)).toBe(false);
  });
  test("unknown reconstructed points have no invented score or ranks, but published standings stay authoritative", () => {
    const source=fixture();source.pairings[0]={...source.pairings[0],result:"1-0",decided:false};
    const published: TournamentSnapshot = {...source,evidenceVersion:1,
      players:source.players.map(p=>({...p,scoreKnown:true,scoreRound:1,scoreSource:"published"})),
      roundStandings:[{round:1,players:source.players.map(p=>({...p,scoreKnown:true,scoreRound:1,scoreSource:"published"}))}]};
    expect(standingsAfterRound(source,1).find(p=>p.startNumber===1)?.scoreKnown).toBe(false);
    expect(standingsAfterRound(published,1).find(p=>p.startNumber===1)).toMatchObject({points:1,scoreKnown:true,rank:1,rankSource:"published"});
    const derived={...source,roundStandings:[],players:source.players.map(p=>({...p,rank:null}))};
    const rows=standingsAfterRound(derived,1);
    expect(rows.find(p=>p.startNumber===1)?.scoreKnown).toBe(false);
    expect(rows.find(p=>p.startNumber===5)?.scoreKnown).toBe(false);
    expect(rows.find(p=>p.startNumber===2)).toMatchObject({points:0,scoreKnown:true});
    expect(rows.every(p=>p.rank===null)).toBe(true);
    expect(standingsAfterRound({...derived,completedRound:0,liveRound:1},1).every(p=>p.rank===null)).toBe(true);
    const future={...derived,roundStandings:[{round:5,players:source.players}]};
    expect(standingsAfterRound(future,1)).toEqual(rows);
    expect(standingsAfterRound({...published,roundStandings:[]},1).every(p=>p.scoreKnown)).toBe(true);
  });
});
