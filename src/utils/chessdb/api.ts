import { fetch } from "@tauri-apps/plugin-http";
import { parseUci } from "chessops";
import { makeFen } from "chessops/fen";
import type { BestMoves, EngineOptions, GoMode, ScoreValue } from "@/bindings";
import { positionFromFen } from "../chessops";

const endpoint = "https://www.chessdb.cn/cdb.php";

type AllResponse = {
    status: string;
    moves?: ChessDBData[];
};

type BestResponse = {
    status: string;
    depth: number;
    score: number;
    pv: string[];
    pvSAN: string[];
};

type ChessDBData = {
    uci: string;
    san: string;
    score: number | string;
    rank?: number;
    note?: string;
    winrate?: string;
};

export type ChessDbCloudMove = {
    uci: string;
    san: string;
    scoreCpForWhite: number | null;
    rank: number | null;
    note: string | null;
    winrate: number | null;
};

export async function getBestMoves(
    _tab: string,
    _goMode: GoMode,
    options: EngineOptions,
): Promise<[number, BestMoves[]] | null> {
    const [pos] = positionFromFen(options.fen);
    if (!pos) {
        return null;
    }
    for (const uci of options.moves) {
        const m = parseUci(uci);
        if (!m) {
            return null;
        }
        pos.play(m);
    }
    const moves = await queryPosition(makeFen(pos.toSetup()));
    return [
        100,
        moves
            .slice(
                0,
                Number.parseInt(
                    options.extraOptions.find((o) => o.name === "MultiPV")?.value ?? "1",
                ),
            )
            .map((m, i) => ({
                score: { value: chessDBevalToScore(m.score), wdl: null },
                nodes: 0,
                depth: m.depth ?? 0,
                multipv: i + 1,
                nps: 0,
                sanMoves: m.san,
                uciMoves: m.uci,
            })),
    ];
}

function chessDBevalToScore(score: number): ScoreValue {
    if (Math.abs(score) > 250_00) {
        return {
            type: "mate",
            value: Math.floor((300_00 - Math.abs(score) + 1) / 2) * (score > 0 ? 1 : -1),
        };
    }
    if (Math.abs(score) > 200_00) {
        return {
            type: "dtz",
            value: (250_00 - Math.abs(score)) * (score > 0 ? 1 : -1),
        };
    }
    if (Math.abs(score) > 150_00) {
        return {
            type: "dtz",
            value: (200_00 - Math.abs(score)) * (score > 0 ? 1 : -1),
        };
    }

    return { type: "cp", value: score };
}

type CachedResult = {
    uci: string[];
    san: string[];
    score: number;
    rank: number;
    note: string;
    depth?: number;
    winrate?: string;
};

const cache = new Map<string, CachedResult[]>();
const cloudMoveCache = new Map<string, ChessDbCloudMove[] | null>();
const cloudMoveInFlightCache = new Map<string, Promise<ChessDbCloudMove[] | null>>();

async function queryPosition(fen: string) {
    if (cache.has(fen)) {
        return cache.get(fen)!;
    }
    const side = fen.split(" ")[1];

    const url = new URL(endpoint);
    url.searchParams.append("action", "queryall");
    url.searchParams.append("json", "1");
    url.searchParams.append("board", fen);
    const res = (await (await fetch(url.toString())).json()) as AllResponse;

    if (res.status !== "ok" || !res.moves?.length) {
        return [];
    }

    const data: CachedResult[] = res.moves.map((m) => ({
        ...m,
        score: side === "b" ? -normaliseChessDbScore(m.score) : normaliseChessDbScore(m.score),
        rank: m.rank ?? 0,
        note: m.note ?? "",
        uci: [m.uci],
        san: [m.san],
    }));

    const best = await queryBest(fen);
    if (best) {
        data[0].depth = best.depth;
        data[0].uci = best.pv;
        data[0].san = best.pvSAN;
    }

    cache.set(fen, data);
    return data;
}

export async function queryChessDbMoves(fen: string): Promise<ChessDbCloudMove[] | null> {
    if (cloudMoveCache.has(fen)) {
        return cloudMoveCache.get(fen)!;
    }
    const inFlight = cloudMoveInFlightCache.get(fen);
    if (inFlight) {
        return inFlight;
    }

    const request = queryChessDbMovesUncached(fen).finally(() => {
        cloudMoveInFlightCache.delete(fen);
    });
    cloudMoveInFlightCache.set(fen, request);
    return request;
}

async function queryChessDbMovesUncached(fen: string): Promise<ChessDbCloudMove[] | null> {
    const side = fen.split(" ")[1];
    const url = new URL(endpoint);
    url.searchParams.append("action", "queryall");
    url.searchParams.append("json", "1");
    url.searchParams.append("showall", "1");
    url.searchParams.append("board", fen);

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error("ChessDB cloud lookup failed.");
    }

    const res = (await response.json()) as AllResponse;
    if (res.status !== "ok" || !res.moves?.length) {
        cloudMoveCache.set(fen, null);
        return null;
    }

    const data = res.moves.map<ChessDbCloudMove>((move) => {
        const score = parseChessDbScore(move.score);
        return {
            uci: move.uci,
            san: move.san,
            scoreCpForWhite: score === null ? null : side === "b" ? -score : score,
            rank: typeof move.rank === "number" ? move.rank : null,
            note: move.note ?? null,
            winrate: parseChessDbWinrate(move.winrate),
        };
    });

    cloudMoveCache.set(fen, data);
    return data;
}

function normaliseChessDbScore(score: number | string) {
    return parseChessDbScore(score) ?? 0;
}

function parseChessDbScore(score: number | string) {
    if (typeof score === "number") return Number.isFinite(score) ? score : null;
    const parsed = Number.parseFloat(score);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseChessDbWinrate(winrate: string | undefined) {
    if (!winrate) return null;
    const parsed = Number.parseFloat(winrate);
    return Number.isFinite(parsed) ? parsed / 100 : null;
}

async function queryBest(fen: string) {
    const url = new URL(endpoint);
    url.searchParams.append("action", "querypv");
    url.searchParams.append("json", "1");
    url.searchParams.append("stable", "1");
    url.searchParams.append("board", fen);
    const res = (await (await fetch(url.toString())).json()) as BestResponse;

    if (res.status !== "ok") {
        return null;
    }

    const side = fen.split(" ")[1];
    if (side === "b") {
        res.score *= -1;
    }

    return res;
}
