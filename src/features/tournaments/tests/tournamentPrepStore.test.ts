import { describe, expect, test } from "vitest";
import type { TournamentSnapshot } from "@/features/tournaments/platform";
import {
  createTournamentPrepRecord,
  parseTournamentPreps,
  serializeTournamentPreps,
  tournamentPrepDatabaseIds,
} from "../tournamentPrepStore";

const SNAPSHOT: TournamentSnapshot = {
  tournamentId: "42",
  sourceUrl: "https://chess-results.com/tnr42.aspx?lan=1",
  title: "Summer Open",
  section: "U1900",
  format: "swiss",
  formatLabel: "Swiss-System",
  totalRounds: 7,
  completedRound: 1,
  publishedRound: 1,
  liveRound: null,
  nextRound: 2,
  phase: "between-rounds",
  dateRange: null,
  timeControl: null,
  sourceUpdatedAt: null,
  fetchedAt: "2026-08-06T12:00:00Z",
  players: [
    {
      startNumber: 1,
      name: "Able, Alice",
      fideId: "123",
      federation: "ENG",
      title: null,
      rating: 2100,
      rank: 1,
      points: 1,
      active: true,
    },
    {
      startNumber: 2,
      name: "Baker, Bob",
      fideId: null,
      federation: "WLS",
      title: null,
      rating: 2000,
      rank: 2,
      points: 0,
      active: true,
    },
  ],
  pairings: [],
  warnings: [],
};

describe("tournament prep persistence", () => {
  test("round-trips a tracking-only tournament without queueing player imports", () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    const parsed = parseTournamentPreps(serializeTournamentPreps({ "42": record }));
    expect(parsed["42"].userName).toBe("Able, Alice");
    expect(parsed["42"].snapshot.section).toBe("U1900");
    expect(parsed["42"].folder).toBe("Tournament · Summer Open");
    expect(parsed["42"].opponents["2"]).toMatchObject({
      name: "Baker, Bob",
      status: "not-imported",
      collectionId: null,
    });
  });

  test("migrates trackers saved before section metadata existed", () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    const legacy = JSON.parse(serializeTournamentPreps({ "42": record }));
    delete legacy["42"].snapshot.section;
    const parsed = parseTournamentPreps(JSON.stringify(legacy));
    expect(parsed["42"].snapshot.section).toBeNull();
  });

  test("preserves a searching state so the sync pass can resume it", () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    record.opponents["2"].status = "searching";
    const parsed = parseTournamentPreps(serializeTournamentPreps({ "42": record }));
    expect(parsed["42"].opponents["2"].status).toBe("searching");
  });

  test("drops malformed records instead of poisoning all trackers", () => {
    const parsed = parseTournamentPreps(
      JSON.stringify({ bad: { title: "No snapshot" }, "42": { snapshot: {} } }),
    );
    expect(parsed).toEqual({});
  });

  test("lists each tracker-created opponent database once for cleanup", () => {
    const record = createTournamentPrepRecord(SNAPSHOT, 1, 2022);
    record.opponents["2"].collectionId = 17;
    record.opponents["3"] = {
      ...record.opponents["2"],
      startNumber: 3,
      collectionId: 17,
    };
    record.opponents["4"] = {
      ...record.opponents["2"],
      startNumber: 4,
      collectionId: null,
    };
    expect(tournamentPrepDatabaseIds(record)).toEqual([17]);
  });
});
