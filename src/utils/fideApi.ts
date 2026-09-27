import { untilFideRequestAborted as untilAborted } from "./fideRequestLifetime";
import {
    lichessBackoffRemaining,
    noteLichessRateLimit,
    queueLichessRequest,
} from "./lichess/requestLane";
import { parseFidePlayer, rankFidePlayers, type FidePlayer } from "./fidePlayer";
export {
    parseFidePlayer,
    rankFidePlayers,
    describeFidePlayer,
    getFideImportStartYear,
    FIDE_IMPORT_FALLBACK_YEAR,
    type FidePlayer,
} from "./fidePlayer";

const BASE_URL = "https://lichess.org/api/fide/player";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_SEARCH_RESULTS = 8;

export class FideLookupError extends Error {
    constructor(kind: "unavailable" | "rate" | "timeout" | "invalid") {
        super(
            {
                unavailable: "FIDE lookup is unavailable. Check your connection and retry.",
                rate: "FIDE lookup is busy. Wait at least a minute before retrying.",
                timeout: "FIDE lookup took too long. Retry the search.",
                invalid: "FIDE lookup returned an unreadable response. Retry the search.",
            }[kind],
        );
        this.name = "FideLookupError";
    }
}

interface FideResult {
    first: FidePlayer | null;
    players: FidePlayer[];
}
interface PendingLookup {
    controller: AbortController;
    promise: Promise<FideResult>;
    readers: number;
}
const cache = new Map<string, FideResult>();
const inFlight = new Map<string, PendingLookup>();

function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("FIDE lookup cancelled", "AbortError");
}

async function fetchPlayers(query: string, signal: AbortSignal): Promise<FideResult> {
    if (lichessBackoffRemaining() > 0) throw new FideLookupError("rate");
    const numeric = /^\d+$/.test(query);
    const response = await fetch(
        numeric ? `${BASE_URL}/${query}` : `${BASE_URL}?q=${encodeURIComponent(query)}`,
        {
            headers: { Accept: "application/json" },
            signal,
        },
    );
    if (signal.aborted) throw abortReason(signal);
    if (response.status === 429) {
        noteLichessRateLimit(response.headers.get("retry-after"));
        throw new FideLookupError("rate");
    }
    // A missing numeric resource returns 404; name searches return an empty array.
    if (numeric && response.status === 404) return { first: null, players: [] };
    if (!response.ok) throw new FideLookupError("unavailable");
    const body: unknown = await response.json().catch(() => {
        throw new FideLookupError("invalid");
    });
    if (signal.aborted) throw abortReason(signal);
    if ((!numeric && !Array.isArray(body)) || (numeric && Array.isArray(body)))
        throw new FideLookupError("invalid");
    const players: FidePlayer[] = [];
    const seen = new Set<number>();
    for (const raw of numeric ? [body] : (body as unknown[])) {
        const player = parseFidePlayer(raw);
        if (!player || (numeric && player.id !== Number(query)))
            throw new FideLookupError("invalid");
        if (!seen.has(player.id)) players.push(player);
        seen.add(player.id);
    }
    return {
        first: players[0] ?? null,
        players: (numeric ? players : rankFidePlayers(query, players)).slice(0, MAX_SEARCH_RESULTS),
    };
}

async function readPlayers(query: string, signal?: AbortSignal): Promise<FideResult> {
    if (signal?.aborted) throw abortReason(signal);
    const trimmed = query.trim();
    const key = trimmed.toLowerCase();
    if (!key) return { first: null, players: [] };
    const saved = cache.get(key);
    if (saved) return saved;
    if (lichessBackoffRemaining() > 0) throw new FideLookupError("rate");
    let pending = inFlight.get(key);
    if (!pending) {
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(new FideLookupError("timeout")),
            REQUEST_TIMEOUT_MS,
        );
        const entry: PendingLookup = {
            controller,
            readers: 0,
            promise: untilAborted(
                queueLichessRequest(
                    () => untilAborted(fetchPlayers(trimmed, controller.signal), controller.signal),
                    { signal: controller.signal, priority: "interactive" },
                ),
                controller.signal,
            )
                .then((result) => {
                    if (controller.signal.aborted) throw abortReason(controller.signal);
                    cache.set(key, result);
                    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
                    return result;
                })
                .catch((error) => {
                    if (controller.signal.aborted) throw abortReason(controller.signal);
                    throw error instanceof FideLookupError
                        ? error
                        : new FideLookupError("unavailable");
                })
                .finally(() => {
                    clearTimeout(timer);
                    if (inFlight.get(key) === entry) inFlight.delete(key);
                }),
        };
        inFlight.set(key, entry);
        pending = entry;
    }
    const entry = pending;
    entry.readers += 1;
    try {
        return await untilAborted(entry.promise, signal);
    } finally {
        entry.readers -= 1;
        if (entry.readers === 0 && inFlight.get(key) === entry) {
            inFlight.delete(key);
            entry.controller.abort();
        }
    }
}

/** Keeps the original first-hit lookup semantics; errors are distinct from misses. */
export async function lookupFidePlayer(
    query: string,
    signal?: AbortSignal,
): Promise<FidePlayer | null> {
    return (await readPlayers(query, signal)).first;
}

/** Ranked suggestions share the same bounded request and cache as direct lookup. */
export async function searchFidePlayers(
    query: string,
    signal?: AbortSignal,
): Promise<FidePlayer[]> {
    return (await readPlayers(query, signal)).players;
}

/** Test isolation; the shared Lichess lane has its own reset hook. */
export function resetFideCacheForTests() {
    for (const entry of inFlight.values()) entry.controller.abort();
    cache.clear();
    inFlight.clear();
}
