import { describe, expect, test } from "vitest";
import { trackerFixture } from "./trackerFixture";
import { pairingScore, standingsAfterRound, tournamentPlayerStats } from "../tournamentInsights";
import { tournamentResultLabel } from "../forecastPresentation";

describe("published awards and missing scores in tracker standings", () => {
  function fixture(result: string | null, decided = true) {
    const { record } = trackerFixture();
    const snapshot = record.snapshot;
    snapshot.players = snapshot.players.map(p => ({ ...p, rank: null, points: 0 }));
    snapshot.pairings = [{ ...snapshot.pairings[0], blackStartNumber: null, result, decided }];
    snapshot.completedRound = 2;
    return snapshot;
  }
  test("explicit full bye beats a stale half-point flag, without double counting", () => {
    const snapshot = fixture("1");snapshot.players[0].halfPointByeRounds = [1];
    expect(standingsAfterRound(snapshot,1)[0]).toMatchObject({ startNumber: 1, points: 1, scoreKnown: true });
    expect(tournamentPlayerStats(snapshot,1).games).toEqual([]);
  });
  test("single-seat half-point award is counted even without a bye flag", () => {
    expect(standingsAfterRound(fixture("½"),1).find(p=>p.startNumber===1)?.points).toBe(0.5);
  });
  test("zero is known even when native decided is false; a missing score remains unknown", () => {
    const zero=standingsAfterRound(fixture("0",false),1).find(p=>p.startNumber===1)!;
    expect(zero).toMatchObject({ points: 0, scoreKnown: true });
    const missing=standingsAfterRound(fixture("-",false),1);
    expect(missing.find(p=>p.startNumber===1)?.scoreKnown).toBe(false);
    expect(missing.every(p=>p.rank===null)).toBe(true);
  });
  test("forfeits contribute standings points without fabricated played-game statistics", () => {
    const snapshot=fixture("+--");snapshot.pairings[0].blackStartNumber=2;
    expect(pairingScore(snapshot.pairings[0],"white")).toBe(1);
    expect(pairingScore(snapshot.pairings[0],"black")).toBe(0);
    expect(standingsAfterRound(snapshot,1)[0].points).toBe(1);
    expect(tournamentPlayerStats(snapshot,1).games).toEqual([]);
    snapshot.pairings[0].result="0F-1F";
    expect(tournamentPlayerStats(snapshot,2).performanceRating).toBeNull();
  });
  test("live games await results while a future published round stays scheduled", () => {
    const snapshot=fixture(null,false);const pairing={...snapshot.pairings[0],round:3,blackStartNumber:2};
    expect(tournamentResultLabel(pairing,snapshot)).toBe("Scheduled");
    snapshot.liveRound=3;
    expect(tournamentResultLabel(pairing,snapshot)).toBe("Awaiting result");
    expect(tournamentResultLabel({...pairing,result:"*"},snapshot)).toBe("Awaiting result");
    expect(tournamentResultLabel({...pairing,blackStartNumber:null,result:"-"},snapshot)).toBe("Score not reported");
  });
});
