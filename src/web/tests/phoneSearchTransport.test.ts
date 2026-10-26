import { afterEach, expect, it, vi } from "vitest";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
import type { EngineSearchLimit } from "../../../scripts/engine-search-protocol.mjs";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const selected = { version: 1 as const, mode: "time" as const, value: 333 };
const health = {
    searchProtocolVersion: 1,
    searchLimits: {
        depth: { min: 1, max: 70 },
        timeMs: { min: 50, max: 3600000 },
        nodes: { min: 1, max: 4294967295 },
        infinite: true,
    },
    resourceProtocolVersion: 1,
    device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
    cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
const meta = {
    type: "meta",
    engineKind: "stockfish",
    engine: "Stockfish 19 fixture",
    searchProtocolVersion: 1,
    searchLimit: selected,
    searchCommand: "go movetime 333",
};
const info = { type: "uci", line: "info depth 8 multipv 1 score cp 20 pv e2e4 e7e5" },
    done = { type: "done", bestmove: "e2e4" };
const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const stream = (...rows: unknown[]) =>
    new Response(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
function fixture(rows: unknown[] = [meta, info, done]) {
    const fetch = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) =>
        String(input).endsWith("/api/engine/start")
            ? json({ ok: true })
            : String(input).endsWith("/v1/health")
              ? json(health)
              : String(input).includes("/v1/cloud-eval")
                ? json({ fen, depth: 65, pvs: [{ moves: "d2d4 d7d5", cp: 21 }] })
                : stream(...rows),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
it("requires explicit completion rather than treating a disconnected search as finished", async () => {
    fixture([meta, info]);
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: selected,
            useStoredEvaluations: false,
        }),
    ).rejects.toThrow(/confirming completion/);
});
it("keeps above-limit depth lines out of an explicitly capped search", async () => {
    const limit = { version: 1 as const, mode: "depth" as const, value: 6 };
    fixture([
        { ...meta, searchLimit: limit, searchCommand: "go depth 6" },
        { ...info, line: "info depth 4 multipv 1 score cp 20 pv e2e4 e7e5" },
        info,
        done,
    ]);
    const result = await analyzeWithWebStockfish18({
        fen,
        depth: 14,
        multipv: 1,
        searchLimit: limit,
        useStoredEvaluations: false,
    });
    expect(result[0].depth).toBe(4);
});
it.each(["pc-only", "live", "prefer-stored"])(
    "captures and acknowledges a search limit through %s without conflicting legacy fields",
    async (branch) => {
        const fetch = fixture();
        const source = { ...selected };
        const pending = analyzeWithWebStockfish18({
            fen,
            depth: 14,
            infinite: true,
            multipv: 1,
            searchLimit: source,
            useStoredEvaluations: branch !== "pc-only",
            preferStoredEvaluation: branch === "prefer-stored",
        });
        source.value = 999;
        expect((await pending)[0].uciMoves[0]).toBe("e2e4");
        const post = fetch.mock.calls.find((call) => String(call[0]).endsWith("/v1/analyze"))!;
        const body = JSON.parse(post[1]!.body as string);
        expect(body.searchLimit).toEqual(selected);
        expect(body.depth).toBeUndefined();
        expect(body.infinite).toBeUndefined();
        expect(body.performancePreset).toBe("good");
    },
);
it("validates simultaneous CPU and search support with one bounded health read", async () => {
    const cpu = { version: 1 as const, threads: 3, hashMb: 333 };
    const fetch = fixture([
        { ...meta, resourceProtocolVersion: 1, cpuResources: cpu, threads: 3, hashMb: 333 },
        info,
        done,
    ]);
    await analyzeWithWebStockfish18({
        fen,
        depth: 14,
        multipv: 1,
        searchLimit: selected,
        cpuResources: cpu,
        useStoredEvaluations: false,
    });
    expect(fetch.mock.calls.filter((call) => String(call[0]).endsWith("/v1/health"))).toHaveLength(
        1,
    );
    const body = JSON.parse(
        fetch.mock.calls.find((call) => String(call[0]).endsWith("/v1/analyze"))![1]!
            .body as string,
    );
    expect(body.cpuResources).toEqual(cpu);
    expect(body.performancePreset).toBeUndefined();
});
it("preserves LCZero choice and network fields while checking the selected search limit", async () => {
    const fetch = fixture([{ ...meta, engineKind: "lc0" }, info, done]);
    await analyzeWithWebStockfish18({
        fen,
        depth: 14,
        multipv: 1,
        engineKind: "lc0",
        searchLimit: selected,
        performancePreset: "eco",
        lc0AutoNetwork: false,
        lc0Network: "none",
    });
    const body = JSON.parse(
        fetch.mock.calls.find((call) => String(call[0]).endsWith("/v1/analyze"))![1]!
            .body as string,
    );
    expect(body).toMatchObject({
        engineKind: "lc0",
        performancePreset: "eco",
        lc0AutoNetwork: false,
        searchLimit: selected,
    });
});
it("cannot apply new limits against a service that only advertises CPU controls", async () => {
    const fetch = fixture();
    fetch.mockImplementation(async (input) =>
        String(input).endsWith("/api/engine/start")
            ? json({ ok: true })
            : json({ ...health, searchProtocolVersion: undefined }),
    );
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: selected,
            useStoredEvaluations: false,
        }),
    ).rejects.toThrow(/search-controls update/);
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith("/v1/analyze"))).toBe(false);
});
it.each([
    { ...meta, searchCommand: "go depth 14" },
    { ...meta, searchLimit: { ...selected, value: 444 } },
    { ...meta, searchProtocolVersion: 2 },
    { ...meta, engineKind: "lc0" },
    null,
])("rejects missing or mismatched acknowledgements before publishing PC lines", async (receipt) => {
    fixture(receipt ? [receipt, info, done] : [info, done]);
    const update = vi.fn();
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: selected,
            useStoredEvaluations: false,
            onUpdate: update,
        }),
    ).rejects.toThrow(/search limit/);
    expect(update).not.toHaveBeenCalled();
});
it("does not call a saved evaluation a successful explicit search after failure", async () => {
    fixture([{ ...meta, searchCommand: "go depth 14" }, info, done]);
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: selected,
            useStoredEvaluations: true,
        }),
    ).rejects.toThrow(/search limit/);
});
it("keeps the original snapshot through a retry and cancels the terminal request", async () => {
    const fetch = fixture();
    let attempt = 0;
    fetch.mockImplementation(async (input) => {
        if (String(input).endsWith("/api/engine/start")) return json({ ok: true });
        if (String(input).endsWith("/v1/health")) return json(health);
        if (++attempt === 1) throw Error("Invented transient stream failure");
        return stream(meta, info, done);
    });
    const source = { ...selected };
    const pending = analyzeWithWebStockfish18({
        fen,
        depth: 14,
        multipv: 1,
        searchLimit: source,
        useStoredEvaluations: false,
    });
    source.value = 555;
    await pending;
    const posts = fetch.mock.calls.filter((call) => String(call[0]).endsWith("/v1/analyze"));
    expect(posts).toHaveLength(2);
    for (const post of posts)
        expect(JSON.parse(post[1]!.body as string).searchLimit).toEqual(selected);
    expect(posts[1][1]!.signal?.aborted).toBe(true);
});
it("rejects mixed report/Plans ownership and malformed values before waking a service", async () => {
    const fetch = fixture();
    for (const extra of [{ planSearch: true }, { reportLimits: { depth: 8, timeMs: 50 } }])
        await expect(
            analyzeWithWebStockfish18({
                fen,
                depth: 14,
                multipv: 1,
                searchLimit: selected,
                ...extra,
            }),
        ).rejects.toThrow(/independent/);
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: { version: 2, mode: "time", value: 50 } as unknown as EngineSearchLimit,
        }),
    ).rejects.toThrow(/invalid/);
    expect(fetch).not.toHaveBeenCalled();
});
it("treats a streamed error as terminal and ignores output sent afterward", async () => {
    fixture([meta, { type: "error", message: "Invented terminal engine failure" }, info, done]);
    const update = vi.fn();
    await expect(
        analyzeWithWebStockfish18({
            fen,
            depth: 14,
            multipv: 1,
            searchLimit: selected,
            useStoredEvaluations: false,
            onUpdate: update,
        }),
    ).rejects.toThrow(/Invented terminal/);
    expect(update).not.toHaveBeenCalled();
});
