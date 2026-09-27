import { describe, expect, test } from "vitest";
import type { TournamentPlayer, TournamentSearchResult } from "@/features/tournaments/platform";
import {
  isChessResultsTournamentUrl,
  rankTournamentPlayers,
  rankTournamentResults,
} from "../tournamentFinder";

const RESULTS: TournamentSearchResult[] = [
  {
    tournamentId: "1",
    sourceUrl: "https://chess-results.com/tnr1.aspx?lan=1",
    title: "Southall Congress 260718 U1900",
    section: "U1900",
    federation: "ENG",
    startDate: "2026/07/18",
    endDate: "2026/07/19",
    lastUpdate: "2 days",
  },
  {
    tournamentId: "2",
    sourceUrl: "https://chess-results.com/tnr2.aspx?lan=1",
    title: "London Junior Rapid U12",
    section: null,
    federation: "ENG",
    startDate: null,
    endDate: null,
    lastUpdate: null,
  },
];

const PLAYERS: TournamentPlayer[] = [
  {
    startNumber: 1,
    name: "Thomas, Mark",
    fideId: "123",
    federation: "ENG",
    title: null,
    rating: 1900,
    rank: null,
    points: 0,
    active: true,
  },
  {
    startNumber: 2,
    name: "Thompson, Mary",
    fideId: null,
    federation: "WLS",
    title: null,
    rating: 1800,
    rank: null,
    points: 0,
    active: true,
  },
];

describe("tournament finder", () => {
  test("recognizes tournament links without requiring a scheme", () => {
    expect(isChessResultsTournamentUrl("chess-results.com/tnr123456.aspx?lan=1")).toBe(true);
    expect(isChessResultsTournamentUrl("https://s1.chess-results.com/tnr42.aspx")).toBe(true);
    expect(isChessResultsTournamentUrl("https://example.com/tnr42.aspx")).toBe(false);
  });

  test("ranks a tournament despite missing and transposed letters", () => {
    expect(rankTournamentResults("Sothuall congres", RESULTS)[0]?.tournamentId).toBe("1");
  });

  test("uses fuzzy matching for the player picker too", () => {
    expect(rankTournamentPlayers("Tomas Mark", PLAYERS)[0]?.startNumber).toBe(1);
  });
});
