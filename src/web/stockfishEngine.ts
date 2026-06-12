import stockfishWorkerUrl from "stockfish/bin/stockfish-18-lite-single.js?url";
import stockfishWasmUrl from "stockfish/bin/stockfish-18-lite-single.wasm?url";
import { parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";
import type { WebEngineLine, WebEngineScore } from "./model";
import { normalizeWebEngineScoreForWhite } from "./engineScore";

const STOCKFISH_READY_TIMEOUT_MS = 20_000;
const STOCKFISH_SEARCH_TIMEOUT_MS = 90_000;
const STOCKFISH_MIN_UPDATE_INTERVAL_MS = 120;

type StockfishLineListener = (line: string) => void;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let activeSearchId = 0;
const listeners = new Set<StockfishLineListener>();

export type WebStockfishAnalyzeRequest = {
    fen: string;
    multipv: number;
    depth: number;
    signal?: AbortSignal;
    onUpdate?: (lines: WebEngineLine[]) => void;
};

export async function analyzeWithWebStockfish18({
    fen,
    multipv,
    depth,
    signal,
    onUpdate,
}: WebStockfishAnalyzeRequest): Promise<WebEngineLine[]> {
    const searchId = ++activeSearchId;
    const requestedMultipv = Math.max(1, Math.min(8, Math.round(multipv)));
    const requestedDepth = Math.max(1, Math.min(30, Math.round(depth)));
    const linesByPv = new Map<number, WebEngineLine>();
    let lastUpdateAt = 0;

    await ensureStockfishReady();
    throwIfAborted(signal);

    postStockfish("stop");
    await setStockfishOption("MultiPV", String(requestedMultipv));
    throwIfAborted(signal);

    return await new Promise<WebEngineLine[]>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            settled = true;
            removeStockfishListener(onLine);
            signal?.removeEventListener("abort", onAbort);
            window.clearTimeout(timeoutId);
        };

        const finish = () => {
            if (settled) return;
            cleanup();
            resolve(sortEngineLines(linesByPv));
        };

        const fail = (error: unknown) => {
            if (settled) return;
            cleanup();
            reject(error);
        };

        const publish = (force = false) => {
            if (!onUpdate || activeSearchId !== searchId) return;
            const now = Date.now();
            if (!force && now - lastUpdateAt < STOCKFISH_MIN_UPDATE_INTERVAL_MS) return;
            lastUpdateAt = now;
            onUpdate(sortEngineLines(linesByPv));
        };

        const onAbort = () => {
            if (activeSearchId === searchId) activeSearchId += 1;
            postStockfish("stop");
            fail(new DOMException("Stockfish analysis was cancelled.", "AbortError"));
        };

        const onLine = (line: string) => {
            if (activeSearchId !== searchId) return;
            if (line.startsWith("bestmove")) {
                publish(true);
                finish();
                return;
            }

            const parsed = parseStockfishInfoLine(line, fen);
            if (!parsed || parsed.multipv > requestedMultipv) return;
            linesByPv.set(parsed.multipv, parsed);
            publish();
        };

        const timeoutId = window.setTimeout(() => {
            postStockfish("stop");
            fail(new Error("Stockfish 18 took too long to finish this search."));
        }, STOCKFISH_SEARCH_TIMEOUT_MS);

        if (signal?.aborted) {
            onAbort();
            return;
        }

        signal?.addEventListener("abort", onAbort, { once: true });
        addStockfishListener(onLine);
        postStockfish(`position fen ${fen}`);
        postStockfish(`go depth ${requestedDepth}`);
    });
}

export function stopWebStockfish18Search() {
    activeSearchId += 1;
    postStockfish("stop");
}

function ensureStockfishReady() {
    readyPromise ??= initializeStockfish();
    return readyPromise;
}

async function initializeStockfish() {
    if (!worker) {
        const workerSource = `${stockfishWorkerUrl}#${encodeURIComponent(stockfishWasmUrl)}`;
        worker = new Worker(workerSource, { name: "stockfish-18" });
        worker.addEventListener("message", (event) => {
            const line = typeof event.data === "string" ? event.data.trim() : "";
            if (!line) return;
            for (const listener of Array.from(listeners)) listener(line);
        });
    }

    postStockfish("uci");
    await waitForStockfishLine((line) => line === "uciok", STOCKFISH_READY_TIMEOUT_MS);
    postStockfish("setoption name UCI_ShowWDL value true");
    postStockfish("isready");
    await waitForStockfishLine((line) => line === "readyok", STOCKFISH_READY_TIMEOUT_MS);
}

async function setStockfishOption(name: string, value: string) {
    postStockfish(`setoption name ${name} value ${value}`);
    postStockfish("isready");
    await waitForStockfishLine((line) => line === "readyok", STOCKFISH_READY_TIMEOUT_MS);
}

function waitForStockfishLine(predicate: (line: string) => boolean, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            removeStockfishListener(listener);
            reject(new Error("Stockfish 18 did not become ready in time."));
        }, timeoutMs);

        const listener = (line: string) => {
            if (!predicate(line)) return;
            window.clearTimeout(timeoutId);
            removeStockfishListener(listener);
            resolve();
        };

        addStockfishListener(listener);
    });
}

function addStockfishListener(listener: StockfishLineListener) {
    listeners.add(listener);
}

function removeStockfishListener(listener: StockfishLineListener) {
    listeners.delete(listener);
}

function postStockfish(command: string) {
    worker?.postMessage(command);
}

function parseStockfishInfoLine(line: string, fen: string): WebEngineLine | null {
    if (!line.startsWith("info ")) return null;

    const [position] = positionFromFen(fen);
    if (!position) return null;

    const tokens = line.trim().split(/\s+/);
    const pvIndex = tokens.indexOf("pv");
    const scoreIndex = tokens.indexOf("score");
    if (pvIndex < 0 || scoreIndex < 0 || scoreIndex + 2 >= tokens.length) return null;

    const uciMoves = tokens
        .slice(pvIndex + 1)
        .filter((token) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token));
    if (uciMoves.length === 0) return null;

    const score = parseStockfishScore(tokens, scoreIndex);
    if (!score) return null;

    return {
        source: "stockfish",
        multipv: readNumericInfoToken(tokens, "multipv") ?? 1,
        depth: readNumericInfoToken(tokens, "depth") ?? 0,
        seldepth: readNumericInfoToken(tokens, "seldepth"),
        nodes: readNumericInfoToken(tokens, "nodes"),
        nps: readNumericInfoToken(tokens, "nps"),
        score: normalizeWebEngineScoreForWhite(score, position.turn),
        uciMoves,
        sanMoves: makeSanLineFromUci(fen, uciMoves),
    };
}

function parseStockfishScore(tokens: string[], scoreIndex: number): WebEngineScore | null {
    const type = tokens[scoreIndex + 1];
    const rawValue = Number.parseInt(tokens[scoreIndex + 2] ?? "", 10);
    if (!Number.isFinite(rawValue)) return null;
    if (type === "cp" || type === "mate") return { type, value: rawValue };
    return null;
}

function readNumericInfoToken(tokens: string[], name: string) {
    const index = tokens.indexOf(name);
    if (index < 0) return null;
    const value = Number.parseInt(tokens[index + 1] ?? "", 10);
    return Number.isFinite(value) ? value : null;
}

function makeSanLineFromUci(fen: string, uciMoves: string[]) {
    const [position] = positionFromFen(fen);
    if (!position) return [];

    const sans: string[] = [];
    for (const uci of uciMoves) {
        const move = parseUci(uci);
        if (!move || !position.isLegal(move)) break;

        const normalized = normalizeMove(position, move);
        sans.push(makeSan(position, normalized));
        position.play(normalized);
    }

    return sans;
}

function sortEngineLines(linesByPv: Map<number, WebEngineLine>) {
    return Array.from(linesByPv.values()).sort((a, b) => a.multipv - b.multipv);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("Stockfish analysis was cancelled.", "AbortError");
    }
}
