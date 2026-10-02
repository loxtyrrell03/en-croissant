import { describe, expect, test } from "vitest";
import type {
  TournamentPairing,
  TournamentPlayer,
  TournamentSnapshot,
} from "@/features/tournaments/platform";
import {
  calculateExactSwissForecast,
  inferSwissAcceleration,
  swissPairingSystemFor,
} from "../exactSwissForecast";
import { calculatePairingForecast, formatForecastPercent } from "../pairingForecast";
import { calibratedRankProbabilities } from "../pairingCalibration";

function player(
  startNumber: number,
  name: string,
  rank: number,
  points: number,
  rating = 2000,
): TournamentPlayer {
  return {
    startNumber,
    name,
    fideId: String(10_000 + startNumber),
    federation: "ENG",
    title: null,
    rating,
    rank,
    points,
    active: true,
  };
}

function pairing(
  round: number,
  whiteStartNumber: number,
  blackStartNumber: number,
  result: string | null,
  board = 1,
): TournamentPairing {
  return {
    round,
    board,
    whiteStartNumber,
    blackStartNumber,
    whitePoints: null,
    blackPoints: null,
    result,
    decided: result !== null,
  };
}

function snapshot(overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  return {
    tournamentId: "42",
    sourceUrl: "https://chess-results.com/tnr42.aspx?lan=1",
    title: "Summer Open",
    section: "U1900",
    format: "swiss",
    formatLabel: "Swiss-System",
    totalRounds: 7,
    completedRound: 2,
    publishedRound: 3,
    liveRound: null,
    nextRound: 3,
    phase: "pairings-published",
    dateRange: null,
    timeControl: null,
    sourceUpdatedAt: null,
    fetchedAt: "2026-08-06T12:00:00Z",
    players: [
      player(1, "Able, Alice", 1, 2, 2200),
      player(2, "Baker, Bob", 2, 2, 2150),
      player(3, "Clark, Cam", 3, 1.5, 2100),
      player(4, "Dunn, Dee", 4, 1.5, 2050),
      player(5, "Evans, Eve", 5, 1, 2000),
      player(6, "Fox, Finn", 6, 1, 1950),
    ],
    pairings: [pairing(1, 1, 4, "1 - 0"), pairing(2, 2, 1, "0 - 1")],
    warnings: [],
    ...overrides,
  };
}

test("large live estimates use the selected player's visible result, preserving unknown and first-round scope", () => {
  const players = Array.from({ length: 130 }, (_, i) => player(i + 1, `Player ${i + 1}`, i + 1, 0, 2200 - i));
  const pairings = Array.from({ length: 65 }, (_, i) => pairing(1, 2 * i + 1, 2 * i + 2, i < 33 ? "1-0" : null, i + 1));
  const event = snapshot({ players, pairings, completedRound: 0, publishedRound: 1, liveRound: 1, nextRound: 2, phase: "round-in-progress" });
  for (const [selected, known] of [[1, true], [100, false]] as const) {
    const forecast = calculatePairingForecast(event, selected);
    expect(forecast.candidates.map(c => c.probability))
      .toEqual(calibratedRankProbabilities(false, 2, 33 / 65, 130, known));
    expect(forecast.otherProbability! + forecast.candidates.reduce((sum, c) => sum + c.probability!, 0)).toBeCloseTo(1);
  }
  const missing = { ...event, pairings: pairings.slice(1) };
  expect(calculatePairingForecast(missing, 1).candidates.map(c => c.probability))
    .toEqual(calibratedRankProbabilities(false, 2, 32 / 64, 130, null));
  const first = { ...event, pairings: [], completedRound: 0, publishedRound: 0, liveRound: null, nextRound: 1, phase: "registration" as const };
  expect(calculatePairingForecast(first, 1).candidates.map(c => c.probability))
    .toEqual(Array(6).fill(null));
});

describe("pairing forecast", () => {
  test.each([
    ["1", "bye published", "1 point"],
    ["1f", "bye published", "1 point"],
    ["+", "bye published", "1 point"],
    ["\u00bd", "half-point bye published", "half a point"],
    ["1/2", "half-point bye published", "half a point"],
    ["0.5", "half-point bye published", "half a point"],
    ["0", "no opponent assigned", "0 points"],
    ["0f", "no opponent assigned", "0 points"],
    [null, "no opponent assigned", "No score is specified"],
    ["", "no opponent assigned", "No score is specified"],
    ["-", "no opponent assigned", "No score is specified"],
    ["---", "no opponent assigned", "No score is specified"],
    ["pending", "no opponent assigned", "No score is specified"],
  ])("describes a published one-seat score %s without inventing an absence reason", (result, summary, caveat) => {
    for (const white of [true, false]) {
      const event = snapshot({ pairings: [{ ...pairing(3, 1, 2, result), whiteStartNumber: white ? 1 : null, blackStartNumber: white ? null : 1, decided: false }] });
      const original = structuredClone(event);
      const forecast = calculatePairingForecast(event, 1);
      expect(forecast).toMatchObject({ kind: "confirmed", confidence: "confirmed", candidates: [], otherProbability: 0 });
      expect(forecast.summary).toContain(summary);
      expect(forecast.caveat).toContain(caveat);
      expect(forecast.summary + forecast.caveat).not.toMatch(/withdraw|requested/i);
      expect(event).toEqual(original);
    }
  });

  test("reads the occupied seat for published byes and preserves named-pairing precedence", () => {
    for (const white of [true, false]) for (const result of ["1-0", "0-1", "1f-0f", "0f-1f", "1/2-1/2"]) {
      const game = { ...pairing(3, 1, 2, result), whiteStartNumber: white ? 1 : null, blackStartNumber: white ? null : 1 };
      const event = snapshot({ pairings: [game] });
      const score = result.split("-")[white ? 0 : 1];
      expect(calculatePairingForecast(event, 1).summary).toBe(score === "1/2"
        ? "Round 3 half-point bye published" : score.startsWith("1") ? "Round 3 bye published" : "Round 3: no opponent assigned");
    }
    const event = snapshot({ pairings: [pairing(3, 1, 3, "0-1")] });
    expect(calculatePairingForecast(event, 1).candidates[0].player.startNumber).toBe(3);
    const missing = snapshot({ pairings: [pairing(3, 2, 3, null)] });
    expect(calculatePairingForecast(missing, 1).kind).toBe("unavailable");
    expect(calculatePairingForecast(missing, 1).summary).not.toContain("bye");
  });

  test("treats a published pairing as confirmed rather than estimated", () => {
    const event = snapshot({ pairings: [...snapshot().pairings, pairing(3, 1, 3, null, 2)] });
    const forecast = calculatePairingForecast(event, 1);
    expect(forecast.kind).toBe("confirmed");
    expect(forecast.candidates[0].player.name).toBe("Clark, Cam");
    expect(forecast.candidates[0].probability).toBe(1);
    expect(forecast.candidates[0].color).toBe("white");
    expect(forecast.candidates[0].board).toBe(2);
    expect(forecast.otherProbability).toBe(0);
  });

  test("removes previous opponents from a Swiss estimate", () => {
    const event = snapshot({
      phase: "round-in-progress",
      liveRound: 3,
      nextRound: 4,
      pairings: [
        ...snapshot().pairings,
        pairing(3, 1, 3, null),
        pairing(3, 2, 4, "1 - 0", 2),
        pairing(3, 5, 6, null, 3),
      ],
    });
    const forecast = calculatePairingForecast(event, 1);
    expect(forecast.kind).toBe("estimated");
    expect(forecast.round).toBe(4);
    expect(forecast.candidates.map((candidate) => candidate.player.startNumber)).not.toContain(2);
    expect(forecast.candidates.map((candidate) => candidate.player.startNumber)).not.toContain(3);
    expect(forecast.candidates[0].reasons.length).toBeGreaterThan(0);
    expect(forecast.summary).toContain("U1900");
    expect(forecast.caveat).toContain("Only players in the U1900 section");
  });

  test("uses replay-calibrated likelihoods and exposes the unlisted field", () => {
    const event = snapshot({
      completedRound: 2,
      publishedRound: 2,
      nextRound: 3,
      phase: "between-rounds",
    });
    const forecast = calculatePairingForecast(event, 1, {
      exactSwiss: calculateExactSwissForecast(event, 3, 1),
    });
    expect(forecast.kind).toBe("estimated");
    expect(forecast.candidates[0].probability).toBeCloseTo(0.601688, 5);
    expect(
      forecast.candidates.reduce((sum, candidate) => sum + candidate.probability!, 0) +
        forecast.otherProbability!,
    ).toBeCloseTo(1);
    expect(forecast.caveat).toContain("whole-field FIDE Dutch");
    expect(formatForecastPercent(forecast.candidates[0].probability)).toBe("~60%");
  });

  test("does not assume certainty from a whole-field reconstruction", () => {
    const event = snapshot({
      completedRound: 2,
      publishedRound: 2,
      nextRound: 3,
      phase: "between-rounds",
    });
    const forecast = calculatePairingForecast(event, 6, {
      exactSwiss: {
        opponentStartNumber: 3,
        color: "white",
        estimatedLiveResults: false,
        system: "dutch",
        acceleration: null,
      },
    });

    expect(forecast.candidates[0].player.startNumber).toBe(3);
    expect(forecast.candidates[0].probability).toBeLessThan(0.7);
    expect(formatForecastPercent(forecast.candidates[0].probability)).toBe("~60%");
  });

  test("keeps first-round uncertainty distinct even in a large field", () => {
    const players = Array.from({ length: 400 }, (_, index) =>
      player(index + 1, `Player ${index + 1}`, index + 1, 0, 2400 - index),
    );
    const event = snapshot({
      totalRounds: 13,
      completedRound: 0,
      publishedRound: 0,
      nextRound: 1,
      phase: "registration",
      players,
      pairings: [],
    });
    const forecast = calculatePairingForecast(event, 400, {
      exactSwiss: {
        opponentStartNumber: 1,
        color: "black",
        estimatedLiveResults: false,
        system: "dutch",
        acceleration: null,
      },
    });

    expect(forecast.candidates[0].player.startNumber).toBe(1);
    expect(forecast.candidates[0].probability).toBeNull();
  });

  test("can render the calibrated fallback while exact solving runs elsewhere", () => {
    const event = snapshot({
      completedRound: 2,
      publishedRound: 2,
      nextRound: 3,
      phase: "between-rounds",
    });
    const forecast = calculatePairingForecast(event, 1, { exactSwiss: null });
    expect(forecast.kind).toBe("estimated");
    expect(forecast.candidates[0].probability).toBeLessThan(0.5);
    expect(forecast.caveat).toContain("Whole-field reconstruction is not available");
  });

  test("does not cap whole-field reconstruction at 80 players", () => {
    const players = Array.from({ length: 82 }, (_, index) =>
      player(index + 1, `Player ${index + 1}`, index + 1, 0, 2400 - index * 5),
    );
    const event = snapshot({
      totalRounds: 9,
      completedRound: 0,
      publishedRound: 0,
      nextRound: 1,
      phase: "registration",
      players,
      pairings: [],
    });
    const exact = calculateExactSwissForecast(event, 1, 1);
    expect(exact?.opponentStartNumber).not.toBeNull();
  });

  test("selects an explicitly named FIDE Swiss pairing system", () => {
    expect(swissPairingSystemFor({ formatLabel: "Swiss-System (Dubov)" })).toBe("dubov");
    expect(swissPairingSystemFor({ formatLabel: "Burstein Swiss" })).toBe("burstein");
    expect(swissPairingSystemFor({ formatLabel: "Lim system" })).toBe("lim");
    expect(swissPairingSystemFor({ formatLabel: "Swiss-System" })).toBe("dutch");

    const event = snapshot({
      completedRound: 0,
      publishedRound: 0,
      nextRound: 1,
      phase: "registration",
      pairings: [],
    });
    expect(calculateExactSwissForecast(event, 1, 1, "dubov")?.system).toBe("dubov");
  });

  test("detects an accelerated Swiss from first-round pairing geometry", () => {
    const players = Array.from({ length: 32 }, (_, index) =>
      player(index + 1, `Player ${index + 1}`, index + 1, index < 16 ? 1 : 0),
    );
    const acceleratedFirstRound = [0, 16].flatMap((offset) =>
      Array.from({ length: 8 }, (_, index) =>
        pairing(1, offset + index + 1, offset + index + 9, "1 - 0", offset / 2 + index + 1),
      ),
    );
    const event = snapshot({
      players,
      pairings: acceleratedFirstRound,
      completedRound: 1,
      publishedRound: 1,
      nextRound: 2,
    });

    expect(inferSwissAcceleration(event)).toBe("two-stage");
    expect(calculateExactSwissForecast(event, 2, 1)?.acceleration).toBe("two-stage");
  });

  test("does not misclassify a conventional Dutch first round as accelerated", () => {
    const players = Array.from({ length: 32 }, (_, index) =>
      player(index + 1, `Player ${index + 1}`, index + 1, index < 16 ? 1 : 0),
    );
    const standardFirstRound = Array.from({ length: 16 }, (_, index) =>
      pairing(1, index + 1, index + 17, "1 - 0", index + 1),
    );

    expect(inferSwissAcceleration(snapshot({ players, pairings: standardFirstRound }))).toBeNull();
  });

  test("shows inferred acceleration in an exact forecast explanation", () => {
    const exact = {
      opponentStartNumber: 3,
      color: "white" as const,
      estimatedLiveResults: false,
      system: "dutch" as const,
      acceleration: "two-stage" as const,
    };
    const forecast = calculatePairingForecast(snapshot(), 1, { exactSwiss: exact });

    expect(forecast.candidates[0].reasons[0]).toContain("inferred acceleration");
    expect(forecast.caveat).toContain("inferred from the published first-round pairings");
  });

  test("reduces uncertainty as results arrive during the preceding round", () => {
    const livePairings = [
      pairing(3, 1, 3, null),
      pairing(3, 2, 4, "1 - 0", 2),
      pairing(3, 5, 6, null, 3),
      pairing(3, 7, 8, "0 - 1", 4),
    ];
    const players = [
      ...snapshot().players,
      player(7, "Gray, Gail", 7, 1, 1900),
      player(8, "Hall, Hugh", 8, 0.5, 1850),
    ];
    const halfResolvedEvent = snapshot({
      players,
      phase: "round-in-progress",
      liveRound: 3,
      nextRound: 4,
      pairings: [...snapshot().pairings, ...livePairings],
    });
    const halfResolved = calculatePairingForecast(halfResolvedEvent, 1, {
      exactSwiss: calculateExactSwissForecast(halfResolvedEvent, 4, 1),
    });
    const noResultsEvent = snapshot({
      players,
      phase: "round-in-progress",
      liveRound: 3,
      nextRound: 4,
      pairings: [
        ...snapshot().pairings,
        ...livePairings.map((item) => ({ ...item, result: null, decided: false })),
      ],
    });
    const noResults = calculatePairingForecast(noResultsEvent, 1, {
      exactSwiss: calculateExactSwissForecast(noResultsEvent, 4, 1),
    });
    expect(halfResolved.candidates[0].probability).toBeGreaterThan(
      noResults.candidates[0].probability!,
    );
    expect(halfResolved.otherProbability).toBeLessThan(noResults.otherProbability!);
  });

  test("derives a deterministic opponent for an unpublished round robin round", () => {
    const event = snapshot({
      format: "round-robin",
      formatLabel: "Round Robin",
      completedRound: 0,
      publishedRound: 0,
      nextRound: 1,
      phase: "registration",
      pairings: [],
      players: snapshot().players.slice(0, 4),
    });
    const forecast = calculatePairingForecast(event, 1);
    expect(forecast.kind).toBe("inferred");
    expect(forecast.confidence).not.toBe("confirmed");
    expect(forecast.caveat).toContain("the organiser has not confirmed this pairing");
    expect(forecast.candidates[0].player.startNumber).toBe(4);
  });

  test("does not imply individual certainty for team events", () => {
    const event = snapshot({ format: "team", formatLabel: "Swiss-System for teams" });
    const forecast = calculatePairingForecast(event, 1);
    expect(forecast.kind).toBe("unavailable");
    expect(forecast.summary).toContain("Team-board");
  });

  test("reports a published bye instead of inventing an opponent", () => {
    const bye: TournamentPairing = {
      round: 3,
      board: null,
      whiteStartNumber: 1,
      blackStartNumber: null,
      whitePoints: null,
      blackPoints: null,
      result: "1 - 0",
      decided: true,
    };
    const forecast = calculatePairingForecast(
      snapshot({ pairings: [...snapshot().pairings, bye] }),
      1,
    );
    expect(forecast.kind).toBe("confirmed");
    expect(forecast.candidates).toEqual([]);
    expect(forecast.summary).toContain("bye");
  });

  test("honours a requested bye from the Chess-Results not-paired list", () => {
    const players = snapshot().players.map((item) =>
      item.startNumber === 1
        ? { ...item, active: false, notPairedRounds: [3], halfPointByeRounds: [3] }
        : item,
    );
    const forecast = calculatePairingForecast(snapshot({ players }), 1);
    expect(forecast.kind).toBe("scheduled");
    expect(forecast.confidence).toBe("confirmed");
    expect(forecast.candidates).toEqual([]);
    expect(forecast.summary).toContain("requested bye");
  });

  test("does not call an unresolved final round a completed tournament", () => {
    const forecast = calculatePairingForecast(
      snapshot({
        totalRounds: 3,
        completedRound: 2,
        publishedRound: 3,
        liveRound: 3,
        nextRound: null,
        phase: "round-in-progress",
      }),
      1,
    );
    expect(forecast.summary).toBe("Round 3 is the final round");
    expect(forecast.caveat).toContain("no later pairing");
  });
});

// All nine rounds, not merely the trivially shared first round.
test("uses Berger opponents through both cycles and supports an odd-field bye", () => {
  const opponents = [10, 2, 3, 4, 5, 6, 7, 8, 9];
  const players = Array.from({length: 10}, (_, i) => player(i + 1, `Player ${i+1}`, i+1, 0));
  for (let round = 1; round <= 18; round++) {
    const f = calculatePairingForecast(snapshot({format: "round-robin", pairings: [], players, nextRound: round, totalRounds: 18}), 1);
    expect(f.kind).toBe("inferred");
    expect(f.candidates[0].player.startNumber).toBe(opponents[(round-1)%9]);
  }
  const bye = calculatePairingForecast(snapshot({format: "round-robin", pairings: [], players: players.slice(0,9), nextRound: 1}), 1);
  expect(bye.kind).toBe("inferred");
  expect(bye.candidates).toEqual([]);
});

test("forfeits do not prevent a later meeting but played games do", () => {
  for (const result of ["+ - -", "0F - 1F", "0 - 0", "- - -"]) {
    const f = calculatePairingForecast(snapshot({players: snapshot().players.slice(0,3), pairings: [pairing(1,1,2,result)]}), 1);
    expect(f.candidates.map(c => c.player.startNumber)).toContain(2);
  }
  const f = calculatePairingForecast(snapshot({players: snapshot().players.slice(0,3), pairings: [pairing(1,1,2,"1 - 0")]}), 1);
  expect(f.candidates.map(c => c.player.startNumber)).not.toContain(2);
});


test("declines Berger inference after a contradictory earlier assignment, even if unfinished", () => {
  const event = snapshot({format:"round-robin", nextRound:2, players:snapshot().players.slice(0,4), pairings:[pairing(1,1,2,null)]});
  const forecast=calculatePairingForecast(event,1);
  expect(forecast.kind).toBe("unavailable");
  expect(forecast.candidates).toEqual([]);
  expect(forecast.summary).toContain("do not match");
  // Actual next-round publication always wins over assumptions.
  event.pairings.push(pairing(2,1,3,null));
  expect(calculatePairingForecast(event,1)).toMatchObject({kind:"confirmed",candidates:[{player:{startNumber:3}}]});
});

test("compatible partial history preserves inference and future rows do not validate it", () => {
  const event=snapshot({format:"round-robin", nextRound:2, players:snapshot().players.slice(0,4), pairings:[pairing(1,1,4,null),pairing(3,1,2,null)]});
  expect(calculatePairingForecast(event,1).kind).toBe("inferred");
  event.pairings[0]=pairing(1,1,2,"0F-1F");
  expect(calculatePairingForecast(event,1).kind).toBe("unavailable");
});


test("does not name an unavailable Berger opponent or infer from duplicate roster identities", () => {
  const event=snapshot({format:"round-robin",nextRound:1,pairings:[],players:snapshot().players.slice(0,4)});
  event.players[3]={...event.players[3],notPairedRounds:[1]};
  expect(calculatePairingForecast(event,1)).toMatchObject({kind:"unavailable",candidates:[]});
  event.players[3]={...event.players[3],notPairedRounds:[],startNumber:3};
  expect(calculatePairingForecast(event,1).kind).toBe("unavailable");
});


test("known incomplete history cannot retain a stale whole-field probability claim",()=>{
  const event=snapshot({pairings:[],incompletePairingRounds:[1]});
  expect(calculateExactSwissForecast(event,3,1)).toBeNull();
  const fallback=calculatePairingForecast(event,1);
  const stale=calculatePairingForecast(event,1,{exactSwiss:{opponentStartNumber:2,color:"white",estimatedLiveResults:false,system:"dutch",acceleration:null}});
  expect(stale).toEqual(fallback);
  expect(stale.caveat).toContain("incomplete history");
});
