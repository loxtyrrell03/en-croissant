import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analyzeWithWebStockfish18, stopWebStockfish18Search } from "../stockfishEngine";
import { loadPcEngineHealth } from "../pcEngineHealth";
import { PcEngineConnectionError } from "../pcEngineConnection";

const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const info = { type: "uci", line: "info depth 8 score cp 20 pv e2e4 e7e5" };
const encoder = new TextEncoder();
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    stopWebStockfish18Search();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
function fixture(analyze: (options: RequestInit) => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
        if (String(input).endsWith("/api/engine/start")) return new Response("{}");
        if (String(input).endsWith("/v1/analyze")) return analyze(options);
        throw new Error(`Unexpected fixture request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}
function run(extra = {}) {
    return analyzeWithWebStockfish18({
        fen,
        depth: 14,
        multipv: 1,
        useStoredEvaluations: false,
        ...extra,
    }).then(
        (lines) => ({ lines, error: null }),
        (error: unknown) => ({ lines: null, error }),
    );
}
const analysisCalls = (fetchMock: ReturnType<typeof fixture>) =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/analyze"));

it.each([408, 429, 500, 502, 503, 504])(
    "preserves transient HTTP %s as recoverable after bounded transport retries",
    async (status) => {
        const fetchMock = fixture(() => new Response("{}", { status }));
        const result = run();
        await vi.advanceTimersByTimeAsync(101);
        expect((await result).error).toBeInstanceOf(PcEngineConnectionError);
        expect(analysisCalls(fetchMock)).toHaveLength(2);
    },
);

it.each([400, 401, 403, 404, 422, 501, 505])(
    "does not retry an invalid or unauthorized HTTP %s request",
    async (status) => {
        const fetchMock = fixture(() => new Response("{}", { status }));
        const result = await run();
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error).not.toBeInstanceOf(PcEngineConnectionError);
        expect(analysisCalls(fetchMock)).toHaveLength(1);
    },
);

it("does not retry malformed streamed JSON or claim a reconnect is happening", async () => {
    const fetchMock = fixture(() => new Response("{malformed\n"));
    const result = await run();
    expect(result.error).toBeInstanceOf(SyntaxError);
    expect(analysisCalls(fetchMock)).toHaveLength(1);
});

it("keeps exhausted real stream stalls recoverable after both attempts produced a valid line", async () => {
    const update = vi.fn();
    const fetchMock = fixture(
        (options) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(`${JSON.stringify(info)}\n`));
                        options.signal?.addEventListener(
                            "abort",
                            () => controller.error(new DOMException("Interrupted", "AbortError")),
                            { once: true },
                        );
                    },
                }),
            ),
    );
    const result = run({ onUpdate: update });
    await vi.advanceTimersByTimeAsync(30_101);
    expect((await result).error).toBeInstanceOf(PcEngineConnectionError);
    expect(analysisCalls(fetchMock)).toHaveLength(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0][0].sanMoves[0]).toBe("e4");
});

it("does not mistake an interrupted infinite stream for a completed finite search", async () => {
    const fetchMock = fixture(() => new Response(`${JSON.stringify(info)}\n`));
    const result = run({ infinite: true });
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).error).toBeInstanceOf(PcEngineConnectionError);
    expect(analysisCalls(fetchMock)).toHaveLength(2);
});

it("classifies health timeouts and temporary HTTP failures as transport errors without weakening invalid responses", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => {})),
    );
    const timedOut = loadPcEngineHealth().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await timedOut).toBeInstanceOf(PcEngineConnectionError);
    for (const status of [408, 429, 503]) {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", { status })),
        );
        await expect(loadPcEngineHealth()).rejects.toBeInstanceOf(PcEngineConnectionError);
    }
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status: 403 })),
    );
    await expect(loadPcEngineHealth()).rejects.not.toBeInstanceOf(PcEngineConnectionError);
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("malformed")),
    );
    await expect(loadPcEngineHealth()).rejects.toBeInstanceOf(SyntaxError);
});

it("cancels a transient retry without converting owner cancellation into a connection failure", async () => {
    const controller = new AbortController();
    const fetchMock = fixture(() => new Response("{}", { status: 503 }));
    const result = run({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).error).toMatchObject({ name: "AbortError" });
    expect(analysisCalls(fetchMock)).toHaveLength(1);
});

it("shows a stored result without letting it end the Live panel's connection recovery", async () => {
    const update = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/v1/cloud-eval"))
            return new Response(
                JSON.stringify({ fen, depth: 55, pvs: [{ moves: "e2e4", cp: 20 }] }),
            );
        if (String(input).endsWith("/api/engine/start")) return new Response("{}");
        throw new TypeError("Invented lost live connection");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = run({ requireLiveResult: true, useStoredEvaluations: true, onUpdate: update });
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).error).toBeInstanceOf(PcEngineConnectionError);
    expect(update).toHaveBeenCalledWith([
        expect.objectContaining({ source: "lichess-cloud", depth: 55 }),
    ]);
    expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/analyze")),
    ).toHaveLength(2);
});
