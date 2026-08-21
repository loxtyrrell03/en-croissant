import { parseUci } from "chessops";
import { normalizeMove } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import type { BestMoves, EngineOptions, GoMode, ScoreValue } from "@/bindings";
import { positionFromFen } from "@/utils/chessops";
import {
    normalizeLc0NetworkProfile,
    readEngineSetting,
    type Lc0NetworkProfile,
} from "@/utils/lc0Networks";
import type { PcEngine } from "@/utils/engines";

const PC_ENGINE_MAX_DEPTH = 70;
const PC_ENGINE_FIRST_LINE_TIMEOUT_MS = 15_000;

export type PcEngineAnalysisUpdate = {
    progress: number;
    lines: BestMoves[];
    engineName: string;
    networkName: string | null;
    networkMode: string | null;
};

export async function getPcEngineBestMoves({
    engine,
    goMode,
    options,
    signal,
    onUpdate,
}: {
    engine: PcEngine;
    goMode: GoMode;
    options: EngineOptions;
    signal?: AbortSignal;
    onUpdate?: (update: PcEngineAnalysisUpdate) => void;
}): Promise<[number, BestMoves[]] | null> {
    const fen = finalFenFromEngineOptions(options);
    const multipv = clampWholeNumber(readEngineSettingValue(options, "MultiPV"), 1, 8, 3);
    const configuredDepth = clampWholeNumber(
        readEngineSettingValue(options, "Depth"),
        1,
        PC_ENGINE_MAX_DEPTH,
        14,
    );
    const depth =
        goMode.t === "Depth" ? clampWholeNumber(goMode.c, 1, 70, configuredDepth) : configuredDepth;
    const infinite = goMode.t === "Infinite";
    const lc0AutoNetwork = parseBooleanSetting(
        readEngineSettingValue(options, "AutoNetwork"),
        true,
    );
    const lc0Network = normalizeLc0NetworkProfile(readEngineSettingValue(options, "OddsMode"));
    const endpoint = `${engine.url.replace(/\/+$/, "")}/v1/analyze`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();

    let firstLineTimedOut = false;
    let firstLineTimeout = window.setTimeout(() => {
        firstLineTimedOut = true;
        controller.abort();
    }, PC_ENGINE_FIRST_LINE_TIMEOUT_MS);
    const markStarted = () => {
        if (firstLineTimeout === 0) return;
        window.clearTimeout(firstLineTimeout);
        firstLineTimeout = 0;
    };

    const linesByPv = new Map<number, BestMoves>();
    let meta: {
        engine?: string;
        networkName?: string;
        networkMode?: string;
    } = {};
    let remoteError: Error | null = null;

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { accept: "application/x-ndjson", "content-type": "application/json" },
            body: JSON.stringify({
                fen,
                multipv,
                depth,
                infinite,
                engineKind: engine.engineKind,
                lc0AutoNetwork: engine.engineKind === "lc0" && lc0AutoNetwork,
                lc0Network: engine.engineKind === "lc0" ? lc0Network : undefined,
            }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Gaming PC engine returned HTTP ${response.status}.`);
        if (!response.body) throw new Error("Gaming PC engine returned an empty response.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const consumeLine = (rawLine: string) => {
            if (!rawLine.trim()) return;
            const message = JSON.parse(rawLine) as {
                type?: string;
                line?: string;
                message?: string;
                engine?: string;
                networkName?: string;
                networkMode?: string;
            };
            if (message.type === "meta") {
                meta = { ...meta, ...message };
                return;
            }
            if (message.type === "error") {
                remoteError = new Error(message.message || "Gaming PC engine failed.");
                return;
            }
            if (message.type !== "uci" || !message.line) return;
            const parsed = parsePcUciInfoLine(message.line, fen);
            if (!parsed || parsed.multipv > multipv) return;
            markStarted();
            linesByPv.set(parsed.multipv, parsed);
            onUpdate?.({
                progress: analysisProgress(goMode, depth, parsed),
                lines: sortedUniqueLines(linesByPv),
                engineName: meta.engine || engine.name,
                networkName: meta.networkName || null,
                networkMode: meta.networkMode || null,
            });
        };

        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const chunks = buffer.split(/\r?\n/);
            buffer = done ? "" : (chunks.pop() ?? "");
            for (const chunk of chunks) consumeLine(chunk);
            if (done) {
                if (buffer.trim()) consumeLine(buffer);
                break;
            }
        }

        if (remoteError) throw remoteError;
        const lines = sortedUniqueLines(linesByPv);
        if (lines.length === 0) throw new Error("Gaming PC engine returned no analysis lines.");
        return [infinite ? 99.99 : 100, lines];
    } catch (error) {
        if (firstLineTimedOut) throw new Error(`${engine.name} did not begin analysis in time.`);
        throw error;
    } finally {
        markStarted();
        signal?.removeEventListener("abort", abort);
    }
}

function finalFenFromEngineOptions(options: EngineOptions) {
    const [position, error] = positionFromFen(options.fen);
    if (!position) throw new Error(`Invalid engine position: ${error || options.fen}`);
    for (const moveText of options.moves) {
        const move = parseUci(moveText);
        if (!move || !position.isLegal(move)) throw new Error(`Invalid engine move: ${moveText}`);
        position.play(normalizeMove(position, move));
    }
    return makeFen(position.toSetup());
}

function readEngineSettingValue(options: EngineOptions, name: string) {
    return readEngineSetting(options.extraOptions, name);
}

function parsePcUciInfoLine(line: string, fen: string): BestMoves | null {
    if (!line.startsWith("info ")) return null;
    const [position] = positionFromFen(fen);
    if (!position) return null;
    const rootTurn = position.turn;
    const tokens = line.trim().split(/\s+/);
    const pvIndex = tokens.indexOf("pv");
    const scoreIndex = tokens.indexOf("score");
    if (
        pvIndex < 0 ||
        scoreIndex < 0 ||
        tokens.includes("lowerbound") ||
        tokens.includes("upperbound")
    ) {
        return null;
    }

    const rawScore = parseScore(tokens, scoreIndex);
    if (!rawScore) return null;
    const uciMoves = tokens
        .slice(pvIndex + 1)
        .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
    if (uciMoves.length === 0) return null;

    const sanMoves: string[] = [];
    for (const uci of uciMoves) {
        const move = parseUci(uci);
        if (!move || !position.isLegal(move)) break;
        const normalized = normalizeMove(position, move);
        sanMoves.push(makeSan(position, normalized));
        position.play(normalized);
    }

    return {
        nodes: numericToken(tokens, "nodes"),
        depth: numericToken(tokens, "depth"),
        score: {
            value: rootTurn === "black" ? invertScore(rawScore) : rawScore,
            wdl: null,
        },
        uciMoves,
        sanMoves,
        multipv: numericToken(tokens, "multipv") || 1,
        nps: numericToken(tokens, "nps"),
    };
}

function parseScore(tokens: string[], scoreIndex: number): ScoreValue | null {
    const type = tokens[scoreIndex + 1];
    const value = Number.parseInt(tokens[scoreIndex + 2] || "", 10);
    if (!Number.isFinite(value) || (type !== "cp" && type !== "mate")) return null;
    return { type, value };
}

function invertScore(score: ScoreValue): ScoreValue {
    return { ...score, value: -score.value };
}

function numericToken(tokens: string[], name: string) {
    const index = tokens.indexOf(name);
    const value = index >= 0 ? Number.parseInt(tokens[index + 1] || "", 10) : 0;
    return Number.isFinite(value) ? value : 0;
}

function sortedUniqueLines(linesByPv: Map<number, BestMoves>) {
    const linesByRoot = new Map<string, BestMoves>();
    for (const line of linesByPv.values()) {
        const key = line.uciMoves[0] || `multipv:${line.multipv}`;
        const previous = linesByRoot.get(key);
        if (
            !previous ||
            line.depth > previous.depth ||
            (line.depth === previous.depth && line.multipv < previous.multipv)
        ) {
            linesByRoot.set(key, line);
        }
    }
    return Array.from(linesByRoot.values()).sort((left, right) => left.multipv - right.multipv);
}

function analysisProgress(goMode: GoMode, depth: number, line: BestMoves) {
    if (goMode.t === "Infinite") return 99.99;
    if (goMode.t === "Nodes") return Math.min(100, (line.nodes / Math.max(1, goMode.c)) * 100);
    return Math.min(100, (line.depth / Math.max(1, depth)) * 100);
}

function parseBooleanSetting(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value.toLowerCase() === "true") return true;
        if (value.toLowerCase() === "false") return false;
    }
    return fallback;
}

function clampWholeNumber(value: unknown, min: number, max: number, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

export function pcEngineNetworkSetting(
    settings: { name: string; value?: string | number | boolean | null }[],
): Lc0NetworkProfile {
    return normalizeLc0NetworkProfile(readEngineSetting(settings, "OddsMode"));
}
