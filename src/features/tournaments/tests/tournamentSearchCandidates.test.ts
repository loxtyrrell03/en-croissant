import { expect, test, vi } from "vitest";
import { supplementTournamentCandidates } from "../tournamentSearchCandidates";
import { defaultDiscoveryFilters, discoveryRequest } from "../tournamentDiscoveryModel";
import type { TournamentDiscoveryResponse, TournamentSearchResult } from "@/features/tournaments/platform";

const request = discoveryRequest({ ...defaultDiscoveryFilters(), country: "ENG" });
const event = (id: string): TournamentSearchResult => ({ tournamentId: id, title: "World Open", sourceUrl: "", section: null,
  federation: "ENG", startDate: null, endDate: null, lastUpdate: null });
const browse: TournamentDiscoveryResponse = { events: [event("1")], sourceCount: 2000, sourceLimitReached: true, fetchedAt: "2026-09-25" };

test("retrieves exact source matches outside the browse cap without losing browse candidates", async () => {
  const fetch = vi.fn(async () => ({ ...browse, events: [event("1"), event("2")] }));
  const result = await supplementTournamentCandidates(request, "world open", browse, fetch, () => true);
  expect(result.events.map(event => event.tournamentId)).toEqual(["1", "2"]);
  expect(result.sourceLimitReached).toBe(true);
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  expect(fetch).toHaveBeenCalledWith({ ...request, query: "world open" });
});
test("does not supplement complete listings, blank text or a cancelled request", async () => {
  const fetch = vi.fn();
  await supplementTournamentCandidates(request, "world", { ...browse, sourceLimitReached: false }, fetch, () => true);
  await supplementTournamentCandidates(request, "", browse, fetch, () => true);
  await supplementTournamentCandidates(request, "world", browse, fetch, () => false);
  expect(fetch).not.toHaveBeenCalled();
});
test("keeps long fuzzy searches within the source field limit", async () => {
  const fetch = vi.fn(async () => browse);
  await supplementTournamentCandidates(request, "a long tournament name ".repeat(10), browse, fetch, () => true);
  for (const [value] of fetch.mock.calls as unknown as [typeof request][]) expect(value.query.length).toBeLessThanOrEqual(50);
});
test("exposes a failed supplemental lookup rather than implying no matches", async () => {
  await expect(supplementTournamentCandidates(request, "world", browse, async () => { throw Error("Source unavailable"); }, () => true)).rejects.toThrow("Source unavailable");
});
