import { afterEach, expect, test, vi } from "vitest";
import { analyzeBoundedWebReport } from "../reportStockfishEngine";
import { analyzeWithWebStockfish18 } from "../stockfishEngine";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const limits = { depth: 8, timeMs: 50 };
const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const stream = (...messages: unknown[]) =>
    new Response(messages.map((m) => JSON.stringify(m)).join("\n"));
const meta = { type: "meta", engine: "Stockfish fixture", reportLimits: limits };
const info = { type: "uci", line: "info depth 7 score cp 18 pv e2e4 e7e5" };
const done = { type: "done", bestmove: "e2e4" };
afterEach(() => {
    vi.unstubAllGlobals();
});

test("the public report path sends frozen limits, never queries cached scores and publishes only a completed choice", async () => {
    const updates = vi.fn(),
        requested = { ...limits };
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/engine/start")) {
            requested.depth = 22;
            return json({ ok: true });
        }
        if (url.includes("/v1/health")) return json({ reportProtocolVersion: 1 });
        expect(url).toContain("/v1/analyze");
        expect(JSON.parse(String(init?.body))).toMatchObject({ reportLimits: limits, depth: 8 });
        return stream(meta, info, done);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 22,
        reportLimits: requested,
        preferStoredEvaluation: true,
        onUpdate: updates,
    });
    expect(result[0]).toMatchObject({ depth: 7, score: { value: 18 } });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
});
test("an older engine service fails before an uncapped search is sent", async () => {
    const fetchMock = vi.fn(async () => json({ version: 18 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
        analyzeBoundedWebReport("http://fixture", {
            fen,
            multipv: 1,
            reportLimits: limits,
            signal: new AbortController().signal,
        }),
    ).rejects.toThrow(/bounded-report update/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
test.each([
    ["missing completion", [meta, info]],
    ["unacknowledged limits", [{ ...meta, reportLimits: { depth: 22, timeMs: 1000 } }, info, done]],
    ["chosen root missing exact evidence", [meta, info, { ...done, bestmove: "d2d4" }]],
    ["bound score", [meta, { ...info, line: "info depth 7 score cp 18 lowerbound pv e2e4" }, done]],
] as const)("a report rejects %s without publishing or retrying", async (_name, messages) => {
    const fetchMock = vi.fn(async (url) =>
        String(url).endsWith("/v1/health")
            ? json({ reportProtocolVersion: 1 })
            : stream(...messages),
    );
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn();
    await expect(
        analyzeBoundedWebReport("http://fixture", {
            fen,
            multipv: 1,
            reportLimits: limits,
            signal: new AbortController().signal,
            onUpdate: update,
        }),
    ).rejects.toThrow(/report|engine|search/i);
    expect(update).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
test("a failed report is not automatically repeated or replaced by stored evidence", async () => {
    let searches = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input) => {
            const url = String(input);
            if (url.includes("/api/engine/start")) return json({ ok: true });
            if (url.includes("/v1/health")) return json({ reportProtocolVersion: 1 });
            expect(url).toContain("/v1/analyze");
            searches++;
            throw new TypeError("Disconnected");
        }),
    );
    await expect(
        analyzeWithWebStockfish18({ fen, multipv: 1, depth: 8, reportLimits: limits }),
    ).rejects.toThrow("Disconnected");
    expect(searches).toBe(1);
});

test("a cancelled report cannot abort its replacement's shared engine startup", async () => {
    let wake!: () => void;
    const waking = new Promise<void>((resolve) => {
        wake = resolve;
    });
    const fetchMock = vi.fn(async (input) => {
        if (String(input).includes("/api/engine/start")) {
            await waking;
            return json({ ok: true });
        }
        if (String(input).includes("/v1/health")) return json({ reportProtocolVersion: 1 });
        return stream(meta, info, done);
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const first = analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 8,
        reportLimits: limits,
        signal: controller.signal,
    }).catch((error) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const second = analyzeWithWebStockfish18({ fen, multipv: 1, depth: 8, reportLimits: limits });
    wake();
    expect(await first).toMatchObject({ name: "AbortError" });
    expect((await second)[0].score.value).toBe(18);
    expect(fetchMock).toHaveBeenCalledTimes(3);
});

class ReportWorker extends EventTarget {
    static instances: ReportWorker[] = [];
    static silent = false;
    static critical = false;
    static engineName = "Stockfish 19 Lite fixture";
    commands: string[] = [];
    terminated = false;
    constructor() {
        super();
        ReportWorker.instances.push(this);
    }
    postMessage(command: string) {
        this.commands.push(command);
        queueMicrotask(() => {
            if (this.terminated) return;
            const lines =
                command === "uci"
                    ? [`id name ${ReportWorker.engineName}`, "uciok"]
                    : command === "isready"
                      ? ["readyok"]
                      : command.startsWith("go ") && !ReportWorker.silent
                        ? ReportWorker.critical ? ["info string CRITICAL ERROR: Invalid position"] : [info.line, "bestmove e2e4"]
                        : [];
            for (const data of lines) this.dispatchEvent(new MessageEvent("message", { data }));
        });
    }
    terminate() {
        this.terminated = true;
    }
}
test("local reports own their worker and send combined limits through the real search adapter", async () => {
    ReportWorker.silent = false;
    vi.stubGlobal("Worker", ReportWorker);
    const result = await analyzeBoundedWebReport("", {
        fen,
        multipv: 1,
        reportLimits: limits,
        signal: new AbortController().signal,
    });
    const worker = ReportWorker.instances.at(-1)!;
    expect(worker.commands).toContain("go depth 8 movetime 40");
    expect(worker.terminated).toBe(true);
    expect(result[0]).toMatchObject({ executionLocation: "phone", depth: 7, engineName: "Stockfish 19 Lite fixture" });
});

test("a critical local report failure rejects immediately and a new owned worker can recover", async () => {
    ReportWorker.silent = false;
    ReportWorker.critical = true;
    vi.stubGlobal("Worker", ReportWorker);
    const request = { fen, multipv: 1, reportLimits: limits, signal: new AbortController().signal };
    await expect(analyzeBoundedWebReport("", request)).rejects.toThrow(/rejected this position/);
    const failed = ReportWorker.instances.at(-1)!;
    expect(failed.terminated).toBe(true);
    ReportWorker.critical = false;
    ReportWorker.engineName = "Stockfish 20 custom fixture";
    try {
        expect((await analyzeBoundedWebReport("", request))[0].engineName).toBe(ReportWorker.engineName);
        expect(ReportWorker.instances.at(-1)).not.toBe(failed);
    } finally {
        ReportWorker.engineName = "Stockfish 19 Lite fixture";
        ReportWorker.critical = false;
    }
});
test("cancelling a silent local report terminates only its owned worker", async () => {
    ReportWorker.silent = true;
    vi.stubGlobal("Worker", ReportWorker);
    const controller = new AbortController();
    const result = analyzeBoundedWebReport("", {
        fen,
        multipv: 1,
        reportLimits: limits,
        signal: controller.signal,
    }).catch((error) => error);
    await vi.waitFor(() =>
        expect(ReportWorker.instances.at(-1)?.commands.some((c) => c.startsWith("go "))).toBe(true),
    );
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(ReportWorker.instances.at(-1)?.terminated).toBe(true);
    ReportWorker.silent = false;
});
