import Fuse from "fuse.js";
import { searchTournamentEvents } from "./tournamentSearch";
import type { TournamentPlayer, TournamentSearchResult } from "@/features/tournaments/platform";

const MAX_TOURNAMENT_RESULTS = 12;

export function isChessResultsTournamentUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    const host = parsed.hostname.toLocaleLowerCase().replace(/\.$/, "");
    return (
      (host === "chess-results.com" || host.endsWith(".chess-results.com")) &&
      /\/tnr\d+\.aspx$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function rankTournamentResults(
  query: string,
  results: TournamentSearchResult[],
): TournamentSearchResult[] {
  return searchTournamentEvents(query, results).slice(0, MAX_TOURNAMENT_RESULTS);
}

export function rankTournamentPlayers(
  query: string,
  players: TournamentPlayer[],
): TournamentPlayer[] {
  const normalized = query.trim();
  if (!normalized) {
    return [...players]
      .sort((left, right) => left.name.localeCompare(right.name));
  }
  return new Fuse(players, {
    keys: [
      { name: "name", weight: 0.76 },
      { name: "fideId", weight: 0.16 },
      { name: "federation", weight: 0.08 },
    ],
    threshold: 0.4,
    distance: 100,
    ignoreLocation: true,
    minMatchCharLength: 2,
  })
    .search(normalized)
    .map(({ item }) => item);
}
