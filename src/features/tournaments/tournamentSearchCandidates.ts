import type { TournamentDiscoveryRequest, TournamentDiscoveryResponse } from "@/features/tournaments/platform";

/** Keep useful source-prefix searches for events outside a capped browse page. */
export async function supplementTournamentCandidates(
  request: TournamentDiscoveryRequest,
  query: string,
  browse: TournamentDiscoveryResponse,
  fetch: (request: TournamentDiscoveryRequest) => Promise<TournamentDiscoveryResponse>,
  current: () => boolean,
): Promise<TournamentDiscoveryResponse> {
  if (!browse.sourceLimitReached || !query.trim() || !current()) return browse;
  const phrase = query.trim().replace(/\s+/g, " ");
  // The source name field only accepts 50 characters. Fetch a bounded set of
  // prefixes; the caller still applies the complete fuzzy query to the union.
  const words = phrase.split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4)
    .sort((a, b) => b.length - a.length);
  const seeds = [...new Set([phrase, ...words].map(seed => Array.from(seed).slice(0, 50).join("")))].slice(0, 3);
  const pages = await Promise.all(seeds.map(query => fetch({ ...request, query })));
  const events = new Map(browse.events.map(event => [event.tournamentId, event]));
  for (const page of pages) for (const event of page.events) events.set(event.tournamentId, event);
  return { ...browse, events: [...events.values()] };
}
