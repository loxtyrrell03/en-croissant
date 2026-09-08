import type { PerformanceGame } from "./truePerformance";
export type PerformanceProvider = "chesscom" | "lichess";
export interface PerformanceAccount {
    id: string;
    provider: PerformanceProvider;
    username: string;
}
export interface PerformanceSnapshot {
    games: PerformanceGame[];
    fetchedAt: number;
    limited: boolean;
}
const DRAW = new Set([
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
]);
type Obj = Record<string, any>;
const obj = (v: unknown): Obj => (v !== null && typeof v === "object" ? (v as Obj) : {});
const rating = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
const header = (pgn: unknown, key: string) =>
    typeof pgn === "string"
        ? pgn.match(new RegExp(`^\\[${key} "([^"\\r\\n]*)"\\]`, "m"))?.[1]
        : undefined;
const preRating = (pgn: unknown, key: string) => {
    const h = header(pgn, key);
    return h && /^\d+$/.test(h) ? Number(h) : null;
};
export function normaliseChessComPerformance(
    raw: unknown,
    account: PerformanceAccount,
    speed: string,
): PerformanceGame | null {
    const g = obj(raw),
        white = obj(g.white),
        black = obj(g.black),
        name = account.username.toLowerCase();
    const isWhite = String(white.username).toLowerCase() === name;
    if (!isWhite && String(black.username).toLowerCase() !== name) return null;
    if (
        g.rules !== "chess" ||
        g.rated !== true ||
        g.time_class !== speed ||
        !Number.isFinite(g.end_time)
    )
        return null;
    const mine = isWhite ? white : black,
        opp = isWhite ? black : white;
    const score =
        mine.result === "win" ? 1 : DRAW.has(mine.result) ? 0.5 : opp.result === "win" ? 0 : null;
    if (score === null) return null;
    const id = typeof g.url === "string" ? g.url : typeof g.uuid === "string" ? g.uuid : null;
    if (!id) return null;
    const url =
        typeof g.url === "string" && /^https:\/\/(www\.)?chess\.com\//i.test(g.url)
            ? g.url
            : undefined;
    return {
        id,
        pool: `${account.id}:${speed}`,
        at: g.end_time,
        // The PGN explicitly captures pre-game Elo. Do not assume the API's current
        // player rating field is pre-game, or fall back to a present-day profile.
        rating: preRating(g.pgn, isWhite ? "WhiteElo" : "BlackElo"),
        opponentRating: preRating(g.pgn, isWhite ? "BlackElo" : "WhiteElo") ?? rating(opp.rating),
        score,
        white: isWhite,
        opponent: String(opp.username ?? ""),
        rated: true,
        url,
        opening: header(g.pgn, "Opening") ?? header(g.pgn, "ECO"),
    };
}
export function normaliseLichessPerformance(
    raw: unknown,
    account: PerformanceAccount,
    speed: string,
): PerformanceGame | null {
    const g = obj(raw),
        players = obj(g.players),
        white = obj(players.white),
        black = obj(players.black);
    const name = (p: Obj) => String(obj(p.user).id ?? obj(p.user).name ?? "").toLowerCase();
    const isWhite = name(white) === account.username.toLowerCase();
    if (!isWhite && name(black) !== account.username.toLowerCase()) return null;
    if (
        g.rated !== true ||
        g.variant !== "standard" ||
        g.speed !== speed ||
        ![
            "mate",
            "resign",
            "stalemate",
            "timeout",
            "draw",
            "outoftime",
            "cheat",
            "variantEnd",
        ].includes(g.status)
    )
        return null;
    const mine = isWhite ? white : black,
        opp = isWhite ? black : white,
        at = (g.lastMoveAt ?? g.createdAt) / 1000;
    if (typeof g.id !== "string" || !/^[a-zA-Z0-9]{8}$/.test(g.id) || !Number.isFinite(at))
        return null;
    const score = g.winner === undefined ? 0.5 : g.winner === (isWhite ? "white" : "black") ? 1 : 0;
    return {
        id: g.id,
        pool: `${account.id}:${speed}`,
        at,
        rating: rating(mine.rating),
        opponentRating: rating(opp.rating),
        opponentSd: opp.provisional === true ? 150 : undefined,
        score,
        white: isWhite,
        opponent: String(obj(opp.user).name ?? ""),
        rated: true,
        url: `https://lichess.org/${g.id}`,
        opening: obj(g.opening).name,
    };
}
const memory = new Map<string, PerformanceSnapshot>();
export function cachedPerformance(key: string): PerformanceSnapshot | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
        const data = JSON.parse(localStorage.getItem(`true-performance-v1:${key}`) ?? "null");
        if (
            data &&
            Array.isArray(data.games) &&
            Number.isFinite(data.fetchedAt) &&
            data.games.length <= 5000
        ) {
            memory.set(key, data);
            return data;
        }
    } catch {
        /* Cache unavailable: fetch remains usable. */
    }
    return null;
}
let lichessCooldownUntil = 0;
/** One bounded provider request at a time within a scan; stop on any failure.
 * Caller receives a complete snapshot or an error, never a silent partial result.
 */
export async function fetchOnlinePerformance(
    account: PerformanceAccount,
    speed: string,
    signal: AbortSignal,
    onProgress: (message: string) => void,
    headers: Record<string, string> = {},
): Promise<PerformanceSnapshot> {
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(account.username))
        throw new Error("Invalid account username");
    if (!["bullet", "blitz", "rapid", "classical", "daily", "correspondence"].includes(speed))
        throw new Error("Invalid time control");
    const LIMIT = 5000;
    async function read(url: string, accept = "application/json") {
        signal.throwIfAborted();
        if (account.provider === "lichess" && Date.now() < lichessCooldownUntil)
            throw new Error("Lichess asked us to wait before refreshing. Try again later.");
        const timeout = AbortSignal.timeout(45000),
            combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(url, {
            signal: combined,
            headers: { ...headers, Accept: accept },
        });
        if (response.status === 429) {
            const raw = response.headers.get("Retry-After");
            const delay =
                raw && /^\d+$/.test(raw)
                    ? Number(raw) * 1000
                    : Math.max(0, Date.parse(raw ?? "") - Date.now());
            if (account.provider === "lichess")
                lichessCooldownUntil = Date.now() + Math.max(60000, delay || 0);
            throw new Error("The website is limiting requests. Wait before refreshing.");
        }
        if (!response.ok) throw new Error(`Could not load games (HTTP ${response.status}).`);
        const text = await response.text();
        if (text.length > 40 * 1024 * 1024) throw new Error("Game response is too large.");
        return text;
    }
    let games: PerformanceGame[] = [],
        limited = false;
    const name = encodeURIComponent(account.username);
    if (account.provider === "lichess") {
        onProgress("Loading rated games from Lichess…");
        const perf = speed === "daily" ? "correspondence" : speed;
        const url = `https://lichess.org/api/games/user/${name}?max=${LIMIT}&perfType=${perf}&rated=true&sort=dateDesc&opening=true&clocks=false&evals=false`;
        const body = await read(url, "application/x-ndjson");
        const lines = body.split(/\r?\n/).filter((l) => l.trim());
        limited = lines.length >= LIMIT;
        games = lines
            .map((l) => normaliseLichessPerformance(JSON.parse(l), account, perf))
            .filter((g): g is PerformanceGame => g !== null);
    } else {
        const data = JSON.parse(
            await read(`https://api.chess.com/pub/player/${name}/games/archives`),
        );
        if (!Array.isArray(data.archives))
            throw new Error("Chess.com returned an invalid archive list.");
        const urls: string[] = data.archives;
        const expected = new RegExp(
            `^https://api\\.chess\\.com/pub/player/${account.username}/games/\\d{4}/\\d{2}$`,
            "i",
        );
        if (urls.some((u) => typeof u !== "string" || !expected.test(u)))
            throw new Error("Unexpected Chess.com archive address.");
        const newest = urls.slice().sort().reverse();
        for (let i = 0; i < newest.length; i++) {
            onProgress(
                `Reading archive ${i + 1} of ${newest.length} · ${games.length.toLocaleString()} rated games…`,
            );
            const archive = JSON.parse(await read(newest[i]));
            if (!Array.isArray(archive.games))
                throw new Error("Chess.com returned an invalid game archive.");
            games.push(
                ...archive.games
                    .map((g: unknown) =>
                        normaliseChessComPerformance(
                            g,
                            account,
                            speed === "correspondence" ? "daily" : speed,
                        ),
                    )
                    .filter((g: PerformanceGame | null): g is PerformanceGame => g !== null),
            );
            if (games.length >= LIMIT) {
                limited = true;
                break;
            }
        }
    }
    signal.throwIfAborted();
    const seen = new Set<string>();
    games = games
        .filter((g) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
        })
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .slice(-LIMIT);
    const snapshot = { games, fetchedAt: Date.now() / 1000, limited };
    const key = `${account.id}:${speed}`;
    memory.set(key, snapshot);
    try {
        localStorage.setItem(`true-performance-v1:${key}`, JSON.stringify(snapshot));
    } catch {
        /* Memory cache remains valid. */
    }
    return snapshot;
}
