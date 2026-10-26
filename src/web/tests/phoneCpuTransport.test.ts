import { afterEach, expect, it, vi } from "vitest";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const selected = { version: 1 as const, threads: 3, hashMb: 333 };
const health = {
    resourceProtocolVersion: 1,
    reportProtocolVersion: 1,
    device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
    cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
const meta = {
    engineKind: "stockfish",
    type: "meta",
    resourceProtocolVersion: 1,
    cpuResources: selected,
    threads: 3,
    hashMb: 333,
    reportLimits: { depth: 8, timeMs: 50 },
};
const info = { type: "uci", line: "info depth 8 multipv 1 score cp 20 pv e2e4 e7e5" };
const done = { type: "done", bestmove: "e2e4" };
const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const stream = (...messages: unknown[]) =>
    new Response(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
function fixture(messages: unknown[] = [meta, info, done]) {
    const fetch = vi.fn(async (url: RequestInfo | URL, _options?: RequestInit) => {
        if (String(url).endsWith("/api/engine/start")) return json({ ok: true });
        if (String(url).endsWith("/v1/health")) return json(health);
        if (String(url).includes("/v1/cloud-eval"))
            return json({ fen, depth: 65, pvs: [{ moves: "d2d4 d7d5", cp: 21 }] });
        return stream(...messages);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
}
it.each(["pc-only", "live", "prefer-stored", "Plans", "report"])(
    "carries exact separate CPU selection through %s without reinterpreting the saved fixed preset",
    async (branch) => {
        const fetch = fixture();
        const results = await analyzeWithWebStockfish18({
            fen,
            multipv: 1,
            depth: 8,
            cpuResources: selected,
            performancePreset: "balanced",
            useStoredEvaluations: branch !== "pc-only",
            preferStoredEvaluation: branch === "prefer-stored",
            planSearch: branch === "Plans",
            ...(branch === "report" ? { reportLimits: { depth: 8, timeMs: 50 } } : {}),
        });
        expect(results[0].uciMoves[0]).toBe("e2e4");
        const posts = fetch.mock.calls.filter((call) => String(call[0]).endsWith("/v1/analyze"));
        expect(posts).toHaveLength(1);
        const options = fetch.mock.calls.find((call) => String(call[0]).endsWith("/v1/analyze"))!;
        const body = JSON.parse((options[1] as RequestInit).body as string);
        expect(body.cpuResources).toEqual(selected);
        expect(body.performancePreset).toBeUndefined();
    },
);
it("does not accept a device field alone or run a CPU search against an older service", async () => {
    const fetch = fixture();
    fetch.mockImplementation(async (url) =>
        String(url).endsWith("/api/engine/start")
            ? json({ ok: true })
            : json({ device: health.device }),
    );
    await expect(
        analyzeWithWebStockfish18({
            fen,
            multipv: 1,
            depth: 8,
            cpuResources: selected,
            useStoredEvaluations: false,
        }),
    ).rejects.toThrow(/resource-controls update/);
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith("/v1/analyze"))).toBe(false);
});
it.each([
    [{ ...meta, hashMb: 2048 }, info, done],
    [info, done],
    [{ type: "done", bestmove: "e2e4" }],
])(
    "rejects missing or mismatched acknowledgement before publishing a PC score",
    async (...messages) => {
        fixture(messages);
        const update = vi.fn();
        await expect(
            analyzeWithWebStockfish18({
                fen,
                multipv: 1,
                depth: 8,
                cpuResources: selected,
                useStoredEvaluations: false,
                onUpdate: update,
            }),
        ).rejects.toThrow(/acknowledge/);
        expect(update).not.toHaveBeenCalled();
    },
);
it("does not turn an unsupported CPU request into a successful stored result", async () => {
    fixture([{ ...meta, hashMb: 2048 }, info, done]);
    await expect(
        analyzeWithWebStockfish18({
            fen,
            multipv: 1,
            depth: 8,
            cpuResources: selected,
            useStoredEvaluations: true,
        }),
    ).rejects.toThrow(/acknowledge/);
});
it("keeps an immutable CPU selection through transport retry", async () => {
    const fetch = fixture();
    let attempts = 0;
    const values = { ...selected };
    fetch.mockImplementation(async (url) => {
        if (String(url).endsWith("/api/engine/start")) return json({ ok: true });
        if (String(url).endsWith("/v1/health")) {
            values.hashMb = 65;
            return json(health);
        }
        attempts++;
        if (attempts === 1) throw new TypeError("Invented connection loss");
        return stream(meta, info, done);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 8,
        cpuResources: values,
        useStoredEvaluations: false,
    });
    const posts = fetch.mock.calls.filter((call) => String(call[0]).endsWith("/v1/analyze"));
    expect(posts).toHaveLength(2);
    for (const post of posts)
        expect(JSON.parse((post[1] as RequestInit).body as string).cpuResources).toEqual(selected);
});
