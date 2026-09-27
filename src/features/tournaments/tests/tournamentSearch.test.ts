import { describe, expect, test } from "vitest";
import type { TournamentSearchResult } from "@/features/tournaments/platform";
import { searchTournamentEvents } from "../tournamentSearch";

const event = (id: string, title: string, extra: Partial<TournamentSearchResult> = {}): TournamentSearchResult => ({
  tournamentId: id, title, sourceUrl: `https://chess-results.com/tnr${id}.aspx`, section: null,
  federation: "ENG", startDate: "2026/09/26", endDate: "2026/09/26", lastUpdate: null, ...extra,
});
// Public event identity; other rows are deliberately synthetic near-matches.
const bristol = event("1488865", "2026 UK Open Blitz Qualifier: Bristol", {
  location: "St Michael’s Centre, North Road, Stoke Gifford BS34 8PD", organizer: "English Chess Federation",
});
const events = [
  event("2", "Boston Open Blitz Qualifier"), event("3", "Bristol Junior Rapid U1800"), bristol,
  event("4", "Autumn Open", { location: "Bristol", organizer: "West Country Chess" }),
  event("5", "Open de São Paulo", { federation: "BRA" }),
  event("6", "Dublin Open", { federation: "IRL" }),
];
const ids = (query: string) => searchTournamentEvents(query, events).map(item => item.tournamentId);

describe("tournament word search", () => {
  test.each(["bristol", "BRISTOL", "bristl", "brsitol", "bistrol", "blitz bristol", "open qualifiers in bristol", "britz bristol", "bristol quali"])("finds the Bristol qualifier for %s", query => {
    expect(ids(query)).toContain(bristol.tournamentId);
    expect(ids(query)).not.toContain("2");
  });
  test("ranks exact title words ahead of approximate matches and venue-only matches", () => {
    expect(searchTournamentEvents("bristol", [event("8", "Briston Open"), events[3], bristol])[0]).toBe(bristol);
  });
  test("matches words across organizer and location fields", () => {
    expect(ids("english gifford qualifiers")).toEqual([bristol.tournamentId]);
    expect(ids("west country bristol")).toEqual(["4"]);
    expect(ids("St Michaels bristol")).toEqual([bristol.tournamentId]);
  });
  test("normalizes accents, punctuation and whitespace", () => {
    expect(ids("  PAULO, sao  ")).toEqual(["5"]);
  });
  test("searches country names and familiar UK terms without conflating Ireland", () => {
    expect(ids("british blitz")).toContain(bristol.tournamentId);
    expect(ids("brazil open")).toEqual(["5"]);
    expect(ids("ireland")).toEqual(["6"]);
  });
  test("does not fuzzy-match a different year or rating section", () => {
    expect(ids("bristol 2027")).toEqual([]);
    expect(ids("bristol u1900")).toEqual([]);
    expect(ids("bristol u1800")).toEqual(["3"]);
  });
  test("requires every meaningful word rather than accepting just a generic word", () => {
    expect(ids("bristol rapid")).toEqual(["3"]);
    expect(ids("nonexistent open")).toEqual([]);
    expect(ids("zz")).toEqual([]);
  });
  test("returns all matches for discovery pagination and preserves source objects", () => {
    const many = Array.from({ length: 45 }, (_, i) => event(String(i), "Bristol Open"));
    expect(searchTournamentEvents("bristol", many)).toHaveLength(45);
    expect(searchTournamentEvents("", many)).toEqual(many);
    expect(searchTournamentEvents("bristol", many)[0]).toBe(many[0]);
  });
});
