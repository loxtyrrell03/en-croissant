import stockfishWorkerUrl from "stockfish/bin/stockfish-18-lite-single.js?url";
import stockfishWasmUrl from "stockfish/bin/stockfish-18-lite-single.wasm?url";
import { parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeSan } from "chessops/san";
import { positionFromFen } from "@/utils/chessops";
import type { WebEngineLine, WebEngineScore } from "./model";
import { normalizeWebEngineScoreForWhite } from "./engineScore";
import { type WebLichessCloudData, webLichessCloudDataToLines } from "./lichessCloud";

const STOCKFISH_READY_TIMEOUT_MS = 20_000;
const STOCKFISH_SEARCH_TIMEOUT_MS = 90_000;
const STOCKFISH_MIN_UPDATE_INTERVAL_MS = 120;
const REMOTE_CLOUD_TIMEOUT_MS = 2_000;
const REMOTE_STOCKFISH_FIRST_LINE_TIMEOUT_MS = 4_000;
const REMOTE_STOCKFISH_RETRY_DELAY_MS = 100;
const REMOTE_STOCKFISH_MAX_ATTEMPTS = 2;
const STORED_CLOUD_CACHE_LIMIT = 160;
const STORED_CLOUD_PREFETCH_LIMIT = 3;
const STOCKFISH_MAX_DEPTH = 70;
const configuredRemoteStockfishUrl = String(
    import.meta.env.VITE_EN_CROISSANT_STOCKFISH_URL ?? `${window.location.origin}/stockfish`,
).trim();
const REMOTE_STOCKFISH_URL = configuredRemoteStockfishUrl.replace(/\/+$/, "");

type StockfishLineListener = (line: string) => void;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let activeSearchId = 0;
let activeRemoteController: AbortController | null = null;
const listeners = new Set<StockfishLineListener>();
const storedCloudLineCache = new Map<string, WebEngineLine[]>();
const storedCloudLineRequests = new Map<string, Promise<WebEngineLine[]>>();

export type WebStockfishAnalyzeRequest = {
    fen: string;
    multipv: number;
    depth: number;
    infinite?: boolean;
    signal?: AbortSignal;
    prefetchFens?: string[];
    onUpdate?: (lines: WebEngineLine[]) => void;
};

export async function analyzeWithWebStockfish18({
    fen,
    multipv,
    depth,
    infinite = false,
    signal,
    prefetchFens = [],
    onUpdate,
}: WebStockfishAnalyzeRequest): Promise<WebEngineLine[]> {
    if (REMOTE_STOCKFISH_URL) {
        try {
            const storedLines = await queryRemoteStoredCloudLines({ fen, multipv, signal });
            throwIfAborted(signal);
            if (storedLines.length > 0) {
                onUpdate?.(storedLines);
                void prefetchRemoteStoredCloudLines(prefetchFens, multipv);
                return storedLines;
            }
        } catch (error) {
            if (isAbortError(error)) throw error;
            console.warn("Stored cloud eval lookup failed; using Gaming PC Stockfish.", error);
        }

        return await analyzeWithRemoteStockfish18WithRetry({
            fen,
            multipv,
            depth,
            infinite,
            signal,
            onUpdate,
        });
    }

    return await analyzeWithLocalStockfish18({
        fen,
        multipv,
        depth,
        infinite,
        signal,
        onUpdate,
    });
}

async function analyzeWithRemoteStockfish18WithRetry(
    request: WebStockfishAnalyzeRequest,
): Promise<WebEngineLine[]> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= REMOTE_STOCKFISH_MAX_ATTEMPTS; attempt += 1) {
        throwIfAborted(request.signal);
        if (attempt > 1) await waitForAbortableDelay(REMOTE_STOCKFISH_RETRY_DELAY_MS, request.signal);

        try {
            return await analyzeWithRemoteStockfish18(request);
        } catch (error) {
            if (isAbortError(error) || request.signal?.aborted) throw error;
            lastError = error;
            console.warn(`Gaming PC Stockfish attempt ${attempt} failed.`, error);
        }
    }

    const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
    throw new Error(`Gaming PC Stockfish is unavailable; phone analysis is disabled.${detail}`);
}

export async function queryRemoteStoredCloudLines({
    fen,
    multipv,
    signal,
}: {
    fen: string;
    multipv: number;
    signal?: AbortSignal;
}): Promise<WebEngineLine[]> {
    if (!REMOTE_STOCKFISH_URL) return [];

    throwIfAborted(signal);
    const request = getRemoteStoredCloudLineRequest(fen, multipv);
    return await waitForStoredCloudLineRequest(request, signal);
}

function getRemoteStoredCloudLineRequest(fen: string, multipv: number) {
    const key = storedCloudCacheKey(fen, multipv);
    const cached = storedCloudLineCache.get(key);
    if (cached) {
        storedCloudLineCache.delete(key);
        storedCloudLineCache.set(key, cached);
        return Promise.resolve(cached);
    }

    const pending = storedCloudLineRequests.get(key);
    if (pending) return pending;

    const request = fetchRemoteStoredCloudLines(fen, multipv)
        .then((lines) => {
            storedCloudLineCache.set(key, lines);
            while (storedCloudLineCache.size > STORED_CLOUD_CACHE_LIMIT) {
                const oldestKey = storedCloudLineCache.keys().next().value;
                if (oldestKey === undefined) break;
                storedCloudLineCache.delete(oldestKey);
            }
            return lines;
        })
        .finally(() => storedCloudLineRequests.delete(key));
    storedCloudLineRequests.set(key, request);
    return request;
}

async function fetchRemoteStoredCloudLines(fen: string, multipv: number) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REMOTE_CLOUD_TIMEOUT_MS);

    const url = new URL(`${REMOTE_STOCKFISH_URL}/v1/cloud-eval`);
    url.searchParams.set("fen", fen);
    url.searchParams.set("multipv", String(Math.max(1, Math.min(8, Math.round(multipv)))));

    try {
        const response = await fetch(url, {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
        });
        if (response.status === 404) return [];
        if (!response.ok) {
            throw new Error(`Stored cloud eval lookup returned HTTP ${response.status}.`);
        }
        const data = (await response.json()) as WebLichessCloudData;
        return webLichessCloudDataToLines(fen, data);
    } catch (error) {
        if (timedOut) throw new Error("Gaming PC stored cloud evals are unreachable.");
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function prefetchRemoteStoredCloudLines(fens: string[], multipv: number) {
    const uniqueFens = Array.from(new Set(fens.map(normalizeStoredCloudFen).filter(Boolean))).slice(
        0,
        STORED_CLOUD_PREFETCH_LIMIT,
    );
    for (const fen of uniqueFens) {
        try {
            await getRemoteStoredCloudLineRequest(fen, multipv);
        } catch {
            break;
        }
    }
}

function waitForStoredCloudLineRequest(
    request: Promise<WebEngineLine[]>,
    signal?: AbortSignal,
): Promise<WebEngineLine[]> {
    if (!signal) return request;
    throwIfAborted(signal);

    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Stockfish analysis was cancelled.", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

function storedCloudCacheKey(fen: string, multipv: number) {
    return `${normalizeStoredCloudFen(fen)}|${Math.max(1, Math.min(8, Math.round(multipv)))}`;
}

function normalizeStoredCloudFen(fen: string) {
    return String(fen || "")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(" ");
}

async function analyzeWithRemoteStockfish18({
    fen,
    multipv,
    depth,
    infinite,
    signal,
    onUpdate,
}: WebStockfishAnalyzeRequest): Promise<WebEngineLine[]> {
    const searchId = ++activeSearchId;
    const requestedMultipv = Math.max(1, Math.min(8, Math.round(multipv)));
    const requestedDepth = Math.max(1, Math.min(STOCKFISH_MAX_DEPTH, Math.round(depth)));
    const linesByPv = new Map<number, WebEngineLine>();
    const controller = new AbortController();
    activeRemoteController?.abort();
    activeRemoteController = controller;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let lastUpdateAt = 0;
    let firstLineTimedOut = false;
    let firstLineTimeoutId: number | null = window.setTimeout(() => {
        firstLineTimedOut = true;
        controller.abort();
    }, REMOTE_STOCKFISH_FIRST_LINE_TIMEOUT_MS);

    const markAnalysisStarted = () => {
        if (firstLineTimeoutId === null) return;
        window.clearTimeout(firstLineTimeoutId);
        firstLineTimeoutId = null;
    };

    const publish = (force = false) => {
        if (!onUpdate || activeSearchId !== searchId) return;
        const now = Date.now();
        if (!force && now - lastUpdateAt < STOCKFISH_MIN_UPDATE_INTERVAL_MS) return;
        lastUpdateAt = now;
        onUpdate(sortEngineLines(linesByPv));
    };

    try {
        throwIfAborted(signal);
        const response = await fetch(`${REMOTE_STOCKFISH_URL}/v1/analyze`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                fen,
                multipv: requestedMultipv,
                depth: requestedDepth,
                infinite: infinite === true,
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Gaming PC Stockfish returned HTTP ${response.status}.`);
        }
        if (!response.body) throw new Error("Gaming PC Stockfish returned an empty response.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let remoteError: Error | null = null;

        const consumeLine = (rawLine: string) => {
            const line = rawLine.trim();
            if (!line) return;
            const message = JSON.parse(line) as {
                type?: string;
                line?: string;
                message?: string;
            };
            if (message.type === "error") {
                remoteError = new Error(message.message || "Gaming PC Stockfish failed.");
                return;
            }
            if (message.type !== "uci" || !message.line) return;
            const parsed = parseStockfishInfoLine(message.line, fen, "gaming-pc");
            if (!parsed || parsed.multipv > requestedMultipv) return;
            markAnalysisStarted();
            linesByPv.set(parsed.multipv, parsed);
            publish();
        };

        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split(/\r?\n/);
            buffer = done ? "" : (lines.pop() ?? "");
            for (const line of lines) consumeLine(line);
            if (done) {
                if (buffer.trim()) consumeLine(buffer);
                break;
            }
        }

        if (remoteError) throw remoteError;
        if (linesByPv.size === 0) {
            throw new Error("Gaming PC Stockfish returned no analysis lines.");
        }
        publish(true);
        return sortEngineLines(linesByPv);
    } catch (error) {
        if (firstLineTimedOut) {
            throw new Error("Gaming PC Stockfish did not begin analysis within four seconds.");
        }
        throw error;
    } finally {
        markAnalysisStarted();
        signal?.removeEventListener("abort", onAbort);
        if (activeRemoteController === controller) activeRemoteController = null;
    }
}

function waitForAbortableDelay(delayMs: number, signal?: AbortSignal) {
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        const onAbort = () => {
            window.clearTimeout(timeoutId);
            reject(new DOMException("Stockfish analysis was cancelled.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function analyzeWithLocalStockfish18({
    fen,
    multipv,
    depth,
    infinite,
    signal,
    onUpdate,
}: WebStockfishAnalyzeRequest): Promise<WebEngineLine[]> {
    const searchId = ++activeSearchId;
    const requestedMultipv = Math.max(1, Math.min(8, Math.round(multipv)));
    const requestedDepth = Math.max(1, Math.min(STOCKFISH_MAX_DEPTH, Math.round(depth)));
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
            if (timeoutId !== null) window.clearTimeout(timeoutId);
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

            const parsed = parseStockfishInfoLine(line, fen, "phone");
            if (!parsed || parsed.multipv > requestedMultipv) return;
            linesByPv.set(parsed.multipv, parsed);
            publish();
        };

        const timeoutId = infinite
            ? null
            : window.setTimeout(() => {
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
        postStockfish(infinite ? "go infinite" : `go depth ${requestedDepth}`);
    });
}

export function stopWebStockfish18Search() {
    activeSearchId += 1;
    activeRemoteController?.abort();
    activeRemoteController = null;
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

function parseStockfishInfoLine(
    line: string,
    fen: string,
    executionLocation: "gaming-pc" | "phone",
): WebEngineLine | null {
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
        executionLocation,
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
    return dedupeWebStockfishLines(Array.from(linesByPv.values()));
}

export function dedupeWebStockfishLines(lines: WebEngineLine[]) {
    const linesByRootMove = new Map<string, WebEngineLine>();

    for (const line of lines) {
        const rootMove = line.uciMoves[0];
        const key = rootMove || `multipv:${line.multipv}`;
        const existing = linesByRootMove.get(key);
        if (
            !existing ||
            line.depth > existing.depth ||
            (line.depth === existing.depth && line.multipv < existing.multipv)
        ) {
            linesByRootMove.set(key, line);
        }
    }

    return Array.from(linesByRootMove.values()).sort((a, b) => a.multipv - b.multipv);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("Stockfish analysis was cancelled.", "AbortError");
    }
}

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
    );
}
