import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { retainWebEngineAnalysis, visibleWebEngineLines } from "../liveEnginePolicy";
import type { WebEngineLine } from "../model";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const line = (source: WebEngineLine["source"]): WebEngineLine => ({
    source,
    depth: 20,
    multipv: 1,
    score: { type: "cp", value: 20 },
    uciMoves: ["e2e4"],
    sanMoves: ["e4"],
});
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
function stream() {
    const value =
        [
            { type: "uci", line: "info depth 8 multipv 1 score cp 30 pv e2e4 e7e5" },
            { type: "done", bestmove: "e2e4" },
        ]
            .map((value) => JSON.stringify(value))
            .join("\n") + "\n";
    return new Response(value, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
    });
}
function stored() {
    return new Response(
        JSON.stringify({ fen, depth: 30, knodes: 1000, pvs: [{ moves: "d2d4 d7d5", cp: 20 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
}
it("local-only bypasses cached hits, prefetch and batch preference", async () => {
    const calls = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/cloud-eval")) return stored();
        if (url.includes("/api/engine/start")) return new Response("{}", { status: 200 });
        if (url.includes("/v1/analyze")) return stream();
        throw new Error(`Unexpected fixture endpoint: ${url}`);
    });
    vi.stubGlobal("fetch", calls);
    const { analyzeWithWebStockfish18 } = await import("../stockfishEngine");
    const cached = await analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 8,
        preferStoredEvaluation: true,
    });
    expect(cached[0].source).toBe("lichess-cloud");
    const actual = await analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 8,
        preferStoredEvaluation: true,
        useStoredEvaluations: false,
        prefetchFens: [fen.replace(" w ", " b ")],
    });
    expect(actual[0].source).toBe("stockfish");
    expect(
        calls.mock.calls.filter(([input]) => String(input).includes("/v1/cloud-eval")),
    ).toHaveLength(1);
});
it("local-only does not borrow a stored score when the PC engine fails", async () => {
    let fail = false;
    const calls = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/cloud-eval")) return stored();
        if (url.includes("/api/engine/start")) return new Response("{}", { status: 200 });
        if (url.includes("/v1/analyze"))
            return fail ? new Response("unavailable", { status: 503 }) : stream();
        throw new Error(`Unexpected fixture endpoint: ${url}`);
    });
    vi.stubGlobal("fetch", calls);
    const { analyzeWithWebStockfish18 } = await import("../stockfishEngine");
    await analyzeWithWebStockfish18({ fen, multipv: 1, depth: 8, preferStoredEvaluation: true });
    fail = true;
    await expect(
        analyzeWithWebStockfish18({ fen, multipv: 1, depth: 8, useStoredEvaluations: false }),
    ).rejects.toThrow("unavailable");
    expect(
        calls.mock.calls.filter(([input]) => String(input).includes("/v1/cloud-eval")),
    ).toHaveLength(1);
});
it("retained scores and arrows reject stored data immediately while real prior scores remain stable", () => {
    const cloud = { fen, lines: [line("lichess-cloud")] };
    const policy = { engineKind: "stockfish" as const, useStoredEvaluations: false };
    expect(retainWebEngineAnalysis(cloud, fen, [], policy)).toBeNull();
    const actual = { fen, lines: [line("stockfish")] };
    expect(retainWebEngineAnalysis(actual, "next-fen", [], policy)).toBe(actual);
    expect(visibleWebEngineLines([line("lichess-cloud"), line("stockfish")], policy)).toEqual([
        line("stockfish"),
    ]);
    expect(
        retainWebEngineAnalysis(actual, fen, [], { engineKind: "lc0", useStoredEvaluations: true }),
    ).toBeNull();
});
