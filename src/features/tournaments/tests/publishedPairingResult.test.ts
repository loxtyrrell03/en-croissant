import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import { publishedGameResult, publishedPairingScore, publishedNoOpponentScore, publishedResultLabel } from "../publishedPairingResult";
import { normalizeTournamentResults } from "../normalizeTournamentResults";
import { calculatePairingForecast, tournamentPhaseLabel } from "../pairingForecast";
import { calculateExactSwissForecast } from "../exactSwissForecast";
import { pairingScore, standingsAfterRound, tournamentPlayerStats } from "../tournamentInsights";

function fixture(): TournamentSnapshot {
  return { tournamentId:"result-contract",sourceUrl:"fixture://result-contract",title:"Synthetic Swiss",section:null,
    format:"swiss",formatLabel:"Swiss-System",totalRounds:5,completedRound:0,publishedRound:1,liveRound:1,nextRound:2,
    phase:"round-in-progress",dateRange:null,timeControl:null,sourceUpdatedAt:null,fetchedAt:"synthetic",warnings:[],
    incompletePairingRounds:[],roundStandings:[],
    players:Array.from({length:8},(_,i)=>({startNumber:i+1,name:`Synthetic ${i+1}`,fideId:null,federation:null,title:null,
      rating:2200-i*5,rank:null,points:0,active:true,notPairedRounds:[],halfPointByeRounds:[]})),
    pairings:Array.from({length:4},(_,i)=>({round:1,board:i+1,whiteStartNumber:i+1,blackStartNumber:i+5,
      whitePoints:0,blackPoints:0,result:i===0?"1-0":null,decided:i===0})) };
}
const unknown = ["", "-", "--", "*", "...", "…", "adjourned", "pending", "0", "1", "½", "1-unknown", "unknown-1", "garbage.5", "½-0", "1-0 trailing", "2-0", "1w-0l", "0l-1w"];

describe("strict published result contract", () => {
  test("valid played results, forfeits and double-zero awards have explicit scores", () => {
    const cases: Array<[string,number,number,boolean]> = [
      ["1-0",1,0,false],["0 - 1",0,1,false],["1–0",1,0,false],
      ["½-½",.5,.5,false],["1/2-1/2",.5,.5,false],["0.5-0.5",.5,.5,false],["0,5-0,5",.5,.5,false],
      ["1F-0F",1,0,true],["0F-1F",0,1,true],["+ - -",1,0,true],["- - +",0,1,true],
      ["0-0",0,0,true],["0F-0F",0,0,true],["---",0,0,true],
    ];
    for(const [result,white,black,forfeit] of cases) {
      const pairing={...fixture().pairings[0],result,decided:true};
      expect(publishedPairingScore(pairing,1),result).toBe(white);
      expect(publishedPairingScore(pairing,5),result).toBe(black);
      expect(Boolean(publishedGameResult(pairing)?.forfeit),result).toBe(forfeit);
      expect(pairingScore(pairing,"white"),result).toBe(white);
      expect(publishedGameResult({...pairing,decided:false}),result).toBeNull();
    }
  });
  test("unknown text and partial numeric tokens never become known from a true flag", () => {
    for(const result of unknown) {
      const pairing={...fixture().pairings[0],result,decided:true};
      expect(publishedGameResult(pairing),result).toBeNull();
      expect(publishedPairingScore(pairing,1),result).toBeNull();
      expect(pairingScore(pairing,"black"),result).toBeNull();
      expect(publishedResultLabel(pairing,fixture()),result).toBe("Awaiting result");
    }
  });
  test("solo zero, half and full awards use only the occupied seat, including legacy false flags", () => {
    for(const side of ["white","black"] as const) for(const [result,score] of [["0",0],["½",.5],["0,5",.5],["1",1]] as const) {
      const pairing={...fixture().pairings[0],whiteStartNumber:side==="white"?1:null,blackStartNumber:side==="black"?1:null,result,decided:false};
      expect(publishedNoOpponentScore(pairing)).toBe(score);
      expect(publishedPairingScore(pairing,1)).toBe(score);
      expect(pairingScore(pairing,side)).toBe(score);
      expect(pairingScore(pairing,side==="white"?"black":"white")).toBeNull();
      expect(normalizeTournamentResults({...fixture(),pairings:[pairing]}).pairings[0].decided).toBe(false);
    }
    for(const result of ["","-","--","---","*","adjourned","unknown-1"]) {
      expect(publishedNoOpponentScore({...fixture().pairings[0],blackStartNumber:null,result})).toBeNull();
    }
    expect(publishedNoOpponentScore({...fixture().pairings[0],whiteStartNumber:null,blackStartNumber:1,result:"0-½"})).toBe(.5);
  });
  test("legacy unreadable flags preserve conditional candidates, colours and ordinary live uncertainty", () => {
    const reference=fixture(), expected=calculatePairingForecast(reference,1);
    for(const result of unknown) {
      const source=fixture();
      source.pairings=source.pairings.map((p,i)=>i===0?p:{...p,result,decided:true});
      const before=structuredClone(source), actual=calculatePairingForecast(source,1);
      expect(actual).toEqual(expected); expect(source).toEqual(before);
      expect(actual.candidates[0].probability).toBeCloseTo(.145264987,9);
      expect(actual.candidates.some(c=>c.player.startNumber===5)).toBe(false);
      expect(normalizeTournamentResults(source).pairings.filter(p=>p.decided)).toHaveLength(1);
    }
    const hidden=fixture(); hidden.pairings[1]={...hidden.pairings[1],result:"1-0",decided:false};
    expect(normalizeTournamentResults(hidden)).toBe(hidden);
    expect(calculatePairingForecast(hidden,1)).toEqual(expected);
  });
  test("old final-round completion is corrected without overriding completed standings", () => {
    const live=fixture(); live.totalRounds=1; live.nextRound=null; live.phase="complete";
    live.pairings=live.pairings.map((p,i)=>i===0?p:{...p,result:"*",decided:true});
    const corrected=normalizeTournamentResults(live);
    expect(corrected).toMatchObject({phase:"round-in-progress",liveRound:1,nextRound:null});
    expect(calculatePairingForecast(live,1).summary).toBe("Round 1 is the final round");
    expect(tournamentPhaseLabel(live)).toBe("Round 1 in progress");
    const beforePlay={...live,pairings:live.pairings.map(p=>({...p,result:"adjourned",decided:true}))};
    expect(normalizeTournamentResults(beforePlay)).toMatchObject({phase:"pairings-published",liveRound:null,nextRound:1});
    expect(calculatePairingForecast(beforePlay,1).kind).toBe("confirmed");
    const complete={...live,completedRound:1};
    expect(normalizeTournamentResults(complete).phase).toBe("complete");
    expect(calculatePairingForecast(complete,1).summary).toBe("Tournament complete");
  });
  test("explicit forfeits remain score awards rather than played games or duplicate requested byes", () => {
    const source=fixture();source.completedRound=1;
    source.pairings=[{...source.pairings[0],result:"0-0",decided:true}];
    expect(tournamentPlayerStats(source,1).games).toEqual([]);
    expect(standingsAfterRound(source,1).find(p=>p.startNumber===1)?.points).toBe(0);
    source.pairings=[{...source.pairings[0],blackStartNumber:null,result:"½",decided:false}];
    source.players[0].halfPointByeRounds=[1];
    expect(standingsAfterRound(source,1).find(p=>p.startNumber===1)?.points).toBe(.5);
  });
  test("small whole-field reconstruction treats unreadable true flags as unresolved, retaining assignments", () => {
    const reference=fixture(), source=fixture();
    source.pairings=source.pairings.map((p,i)=>i===0?p:{...p,result:"1-unknown",decided:true});
    expect(calculateExactSwissForecast(source,2,1)).toEqual(calculateExactSwissForecast(reference,2,1));
    expect(calculatePairingForecast(source,1).candidates.some(c=>c.player.startNumber===5)).toBe(false);
    const pending=fixture();pending.pairings[0]={...pending.pairings[0],result:"0-0",decided:false};
    expect(calculatePairingForecast(pending,1).candidates.some(c=>c.player.startNumber===5)).toBe(false);
  });
});
