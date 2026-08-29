/**
 * FIDE player lookup via the Lichess FIDE mirror (anonymous, public).
 * Numeric queries hit the id endpoint, anything else the name search (first
 * hit wins). Failures and misses resolve to null — the UI shows a quiet
 * "no match" state instead of an error. Results are cached in memory for the
 * session, misses included.
 */

export interface FidePlayer {
    id: number;
    name: string;
    title?: string;
    federation?: string;
    year?: number;
    standard?: number;
    rapid?: number;
    blitz?: number;
    inactive?: boolean;
}

export const FIDE_IMPORT_FALLBACK_YEAR = 1900;

/**
 * Uses an explicit valid year when the user has chosen one; otherwise the
 * player's valid FIDE birth year starts a full-career import. Unknown or
 * malformed birth years fall back to 1900 so no available games are skipped.
 */
export function getFideImportStartYear(
    player: Pick<FidePlayer, "year"> | null | undefined,
    currentYear: number,
    manualYear?: number | null,
): number {
    const isValidYear = (year: number | null | undefined): year is number =>
        typeof year === "number" &&
        Number.isInteger(year) &&
        year >= FIDE_IMPORT_FALLBACK_YEAR &&
        year <= currentYear;

    if (isValidYear(manualYear)) return manualYear;
    if (isValidYear(player?.year)) return player.year;
    return FIDE_IMPORT_FALLBACK_YEAR;
}

interface RawFidePlayer {
    id?: number;
    name?: string;
    title?: string;
    federation?: string;
    year?: number;
    standard?: number;
    rapid?: number;
    blitz?: number;
    inactive?: boolean;
}

const BASE_URL = "https://lichess.org/api/fide/player";

/** Pure mapper, unit-testable without network access. */
export function parseFidePlayer(raw: unknown): FidePlayer | null {
    if (!raw || typeof raw !== "object") return null;
    const player = raw as RawFidePlayer;
    if (typeof player.id !== "number" || typeof player.name !== "string") return null;
    return {
        id: player.id,
        name: player.name,
        title: typeof player.title === "string" ? player.title : undefined,
        federation: typeof player.federation === "string" ? player.federation : undefined,
        year: typeof player.year === "number" ? player.year : undefined,
        standard: typeof player.standard === "number" ? player.standard : undefined,
        rapid: typeof player.rapid === "number" ? player.rapid : undefined,
        blitz: typeof player.blitz === "number" ? player.blitz : undefined,
        inactive: player.inactive === true ? true : undefined,
    };
}

const cache = new Map<string, FidePlayer | null>();
const inFlight = new Map<string, Promise<FidePlayer | null>>();
const searchCache = new Map<string, FidePlayer[]>();
const searchInFlight = new Map<string, Promise<FidePlayer[]>>();

/** Test hook: clears the session cache. */
export function resetFideCacheForTests() {
    cache.clear();
    inFlight.clear();
    searchCache.clear();
    searchInFlight.clear();
}

export async function lookupFidePlayer(query: string): Promise<FidePlayer | null> {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key) ?? null;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = (async () => {
        try {
            const isId = /^\d+$/.test(key);
            const url = isId
                ? `${BASE_URL}/${key}`
                : `${BASE_URL}?q=${encodeURIComponent(query.trim())}`;
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) {
                cache.set(key, null);
                return null;
            }
            const body: unknown = await response.json();
            const player = parseFidePlayer(Array.isArray(body) ? body[0] : body);
            cache.set(key, player);
            return player;
        } catch {
            // Network trouble: do not cache, so a reopen can retry.
            return null;
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, request);
    return request;
}

const MAX_SEARCH_RESULTS = 8;

function nameTokens(name: string): string[] {
    return name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * The upstream search returns up to 30 loosely-ordered hits — a one-letter
 * term can float an unrelated player to the top. Re-rank so the player the
 * typist meant leads: surname carries the most signal, active over inactive,
 * stronger rating breaks ties. Pure, so it is unit-testable offline.
 */
export function rankFidePlayers(query: string, players: FidePlayer[]): FidePlayer[] {
    const terms = nameTokens(query);
    if (!terms.length) return players;
    return players
        .map((player, index) => {
            const tokens = nameTokens(player.name);
            let score = 0;
            for (const term of terms) {
                if (tokens.some((token) => token === term)) score += 12;
                else if (tokens.some((token) => token.startsWith(term))) score += 7;
                else if (tokens.some((token) => token.includes(term))) score += 2;
            }
            const surname = tokens[0];
            if (surname === terms[0]) score += 10;
            else if (surname?.startsWith(terms[0])) score += 5;
            if (player.inactive) score -= 6;
            const rating = player.standard ?? player.rapid ?? player.blitz ?? 0;
            return { player, score, rating, index };
        })
        .sort((a, b) => b.score - a.score || b.rating - a.rating || a.index - b.index)
        .map((entry) => entry.player);
}

/**
 * Multi-result sibling of lookupFidePlayer, for the import picker. A numeric
 * query resolves the id directly; anything else runs the name search. Never
 * throws — an empty list is the miss state.
 */
export async function searchFidePlayers(query: string): Promise<FidePlayer[]> {
    const trimmed = query.trim();
    const key = trimmed.toLowerCase();
    if (!key) return [];
    const cached = searchCache.get(key);
    if (cached) return cached;
    const pending = searchInFlight.get(key);
    if (pending) return pending;

    const request = (async () => {
        try {
            const isId = /^\d+$/.test(key);
            const url = isId
                ? `${BASE_URL}/${key}`
                : `${BASE_URL}?q=${encodeURIComponent(trimmed)}`;
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            if (!response.ok) {
                searchCache.set(key, []);
                return [];
            }
            const body: unknown = await response.json();
            const raw: unknown[] = Array.isArray(body) ? body : [body];
            const seen = new Set<number>();
            const players: FidePlayer[] = [];
            for (const entry of raw) {
                const player = parseFidePlayer(entry);
                if (!player || seen.has(player.id)) continue;
                seen.add(player.id);
                players.push(player);
            }
            const ranked = isId ? players : rankFidePlayers(trimmed, players);
            const limited = ranked.slice(0, MAX_SEARCH_RESULTS);
            searchCache.set(key, limited);
            return limited;
        } catch {
            // Network trouble: do not cache, so the next keystroke can retry.
            return [];
        } finally {
            searchInFlight.delete(key);
        }
    })();
    searchInFlight.set(key, request);
    return request;
}

/** Player metadata as one scannable line: NOR · b. 1990 · 2823 */
export function describeFidePlayer(player: FidePlayer): string {
    const parts: string[] = [];
    if (player.federation) parts.push(player.federation);
    if (player.year) parts.push(`b. ${player.year}`);
    const rating = player.standard ?? player.rapid ?? player.blitz;
    if (rating) parts.push(String(rating));
    if (player.inactive) parts.push("inactive");
    return parts.join(" · ");
}
