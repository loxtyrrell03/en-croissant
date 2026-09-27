import type { TournamentSearchResult } from "@/features/tournaments/platform";
import countries from "./tournamentCountries.json";

const CONNECTORS = new Set(["the", "a", "an", "in", "at", "of", "and", "for"]);
const UK_FEDERATIONS = new Set(["ENG", "SCO", "WLS", "NIR", "GBR"]);

function words(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[’']/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Adjacent transpositions count as one typo. Short words and numbers must
// match exactly; otherwise a year or rating section could become another one.
function wordCost(query: string, candidate: string): number {
  if (query === candidate) return 0;
  if (/\d/.test(query) || /\d/.test(candidate)) return Infinity;
  if (query.length >= 3 && candidate.startsWith(query)) return 0.12;
  const limit = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  if (!limit || Math.abs(query.length - candidate.length) > limit) return Infinity;
  let previous = Array.from({ length: candidate.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= query.length; i++) {
    const row = [i];
    for (let j = 1; j <= candidate.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (query[i - 1] === candidate[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && query[i - 1] === candidate[j - 2] && query[i - 2] === candidate[j - 1]) {
        row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = row;
  }
  const distance = previous[candidate.length];
  return distance <= limit ? 0.3 * distance : Infinity;
}

/** All meaningful query words must match, in any order and across fields. */
export function searchTournamentEvents(query: string, events: TournamentSearchResult[]): TournamentSearchResult[] {
  const tokens = [...new Set(words(query).filter(word => !CONNECTORS.has(word)))];
  if (!tokens.length) return [...events];
  return events.map((event, index) => {
    const country = countries.find(item => item.code === event.federation);
    const fields: Array<[string | null | undefined, number]> = [
      [event.title, 0], [event.section, 0.02], [event.location, 0.04],
      [event.organizer, 0.08], [event.timeControl, 0.08],
      [[event.federation, country?.name, ...(country?.regions.filter(region => region !== "UK & Ireland") ?? []),
        UK_FEDERATIONS.has(event.federation ?? "") ? "UK United Kingdom Britain British" : "",
      ].filter(Boolean).join(" "), 0.1],
    ];
    const vocabulary = fields.flatMap(([value, penalty]) => words(value ?? "").map(word => ({ word, penalty })));
    let score = 0;
    for (const token of tokens) {
      let best = Infinity;
      for (const { word, penalty } of vocabulary) best = Math.min(best, wordCost(token, word) + penalty);
      if (!Number.isFinite(best)) return { event, index, score: Infinity };
      score += best;
    }
    // Prefer an exact title phrase when all other words match equally well.
    if (words(event.title).join(" ").includes(tokens.join(" "))) score -= 0.01;
    return { event, index, score };
  }).filter(result => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(result => result.event);
}
