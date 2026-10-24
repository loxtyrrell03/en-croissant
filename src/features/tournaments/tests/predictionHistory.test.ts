import { describe, expect, test } from "vitest";
import { trackerFixture } from "./trackerFixture";
import { comparePrediction, emptyPredictionHistory, mergePredictionHistory, playerPredictionRounds, predictionToSave, publishedOpponent } from "../predictionHistory";

function fixture() {
  const { record, forecast } = trackerFixture();
  const snapshot = record.snapshot, player = snapshot.players[0];
  const prediction = predictionToSave(snapshot, player, forecast, false, 0, "2026-10-24T14:00:00Z")!;
  const capture = { player, round: 5, prediction };
  const history = mergePredictionHistory(emptyPredictionHistory(record.id), snapshot, capture);
  const official = { ...snapshot, publishedRound: 5, pairings: [...snapshot.pairings, { round: 5, board: 1, whiteStartNumber: 3, blackStartNumber: 1, whitePoints: 0, blackPoints: 0, result: null, decided: false }] };
  return { snapshot, player, forecast, prediction, capture, history, official };
}

describe("saved tournament predictions", () => {
  test("compares the frozen second suggestion and its colour against the published opponent", () => {
    const f = fixture(), actual = publishedOpponent(f.official, f.player, 5)!;
    const result = comparePrediction(f.prediction, actual);
    expect(actual.player?.name).toBe("Sam Rivera");
    expect(result.rank).toBe(2);
    expect(result.candidate?.probability).toBe(.23);
    expect(actual.color).toBe("black");
    expect(result.candidate?.color).toBe("black");
  });
  test("never substitutes a confirmed prediction, a pending calculation or a later snapshot for history", () => {
    const f=fixture();
    expect(predictionToSave(f.official,f.player,f.forecast,false)).toBeNull();
    expect(predictionToSave(f.snapshot,f.player,f.forecast,true)).toBeNull();
    expect(predictionToSave(f.snapshot,f.player,{...f.forecast,kind:"confirmed"},false)).toBeNull();
    expect(predictionToSave({...f.snapshot,nextRound:6},f.player,f.forecast,false)).toBeNull();
    expect(predictionToSave({...f.snapshot,pairings:[...f.snapshot.pairings,{...f.official.pairings.at(-1)!,whiteStartNumber:4,blackStartNumber:5}]},f.player,f.forecast,false)).toBeNull();
  });
  test("deduplicates and keeps the first and two latest distinct pre-publication forecasts", () => {
    const f=fixture();let h=f.history;
    for(let i=0;i<5;i++) h=mergePredictionHistory(h,f.snapshot,{...f.capture,prediction:{...f.prediction,capturedAt:`2026-10-24T14:0${i+1}:00Z`,manualResults:i+1}});
    expect(h.rounds[0].versions.map(v=>v.manualResults)).toEqual([0,4,5]);
    expect(mergePredictionHistory(h,f.snapshot,{...f.capture,prediction:{...h.rounds[0].versions[2],capturedAt:"2026-10-24T15:00:00Z"}})).toEqual(h);
    expect(f.history.rounds[0].versions).toHaveLength(1);
  });
  test("publication closes the round even when a stale window tries to save an older input", () => {
    const f=fixture(), closed=mergePredictionHistory(f.history,f.official);
    const late=mergePredictionHistory(closed,f.snapshot,{...f.capture,prediction:{...f.prediction,manualResults:5}});
    expect(late.rounds[0].versions).toEqual(f.history.rounds[0].versions);
    expect(late.closedThrough).toBe(5);
    expect(late.rounds[0].published?.label).toBe("Sam Rivera");
  });
  test("official correction changes the comparison, never the forecast", () => {
    const f=fixture(), closed=mergePredictionHistory(f.history,f.official);
    const corrected={...f.official,pairings:f.official.pairings.map(p=>p.round===5?{...p,whiteStartNumber:4}:p)};
    const next=mergePredictionHistory(closed,corrected);
    expect(next.rounds[0].published?.label).toBe("Jamie Chen");
    expect(next.rounds[0].corrected).toBe(true);
    expect(next.rounds[0].versions).toEqual(closed.rounds[0].versions);
  });
  test("missing capture and outside-shortlist probability remain unknown", () => {
    const f=fixture(), actual=publishedOpponent(f.official,f.player,5);
    expect(comparePrediction(undefined,actual)).toEqual({rank:null,candidate:null});
    expect(comparePrediction({...f.prediction,candidates:f.prediction.candidates.slice(0,1)},actual)).toEqual({rank:null,candidate:null});
    const unknown={...f.forecast,candidates:f.forecast.candidates.map(c=>({...c,probability:null})),otherProbability:null};
    expect(predictionToSave(f.snapshot,f.player,unknown,false)!.candidates[0].probability).toBeNull();
  });
  test("does not manufacture a pairing or a bye for missing and conflicting assignments", () => {
    const f=fixture();
    expect(publishedOpponent(f.snapshot,f.player,5)).toBeNull();
    const conflict={...f.official,pairings:[...f.official.pairings,{...f.official.pairings.at(-1)!,whiteStartNumber:4}]};
    expect(publishedOpponent(conflict,f.player,5)).toBeNull();
    const bye={...f.official,pairings:[...f.snapshot.pairings,{...f.official.pairings.at(-1)!,whiteStartNumber:1,blackStartNumber:null,result:"1",whitePoints:1,decided:true}]};
    expect(publishedOpponent(bye,f.player,5)?.player).toBeNull();
    expect(publishedOpponent(bye,f.player,5)?.label).toBe("Full-point bye");
  });
  test("history follows stable identity through renumbering but refuses ambiguous identities", () => {
    const f=fixture(), renumbered={...f.snapshot,players:f.snapshot.players.map(p=>p===f.player?{...p,startNumber:99}:p)};
    expect(playerPredictionRounds(f.history,renumbered,renumbered.players[0])).toHaveLength(1);
    expect(playerPredictionRounds(f.history,{...f.snapshot,players:[...f.snapshot.players,{...f.player,startNumber:99}]},f.player)).toEqual([]);
    const other=f.snapshot.players[1];
    expect(playerPredictionRounds(f.history,f.snapshot,other)).toEqual([]);
  });
  test("rejects ambiguous viewed players and preserves an unknown expected colour", () => {
    const f=fixture();
    expect(predictionToSave({...f.snapshot,players:[...f.snapshot.players,{...f.player,startNumber:99}]},f.player,f.forecast,false)).toBeNull();
    expect(predictionToSave(f.snapshot,f.player,{...f.forecast,candidates:[{...f.forecast.candidates[0],color:null}]},false)!.candidates[0].color).toBeNull();
  });
});
