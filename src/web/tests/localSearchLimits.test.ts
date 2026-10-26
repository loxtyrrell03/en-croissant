import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EngineSearchLimit } from "../../../scripts/engine-search-protocol.mjs";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
class SearchWorker extends EventTarget {
    static workers: SearchWorker[] = [];
    static finish = true;
    static acknowledgeStop = true;
    static holdHandshake = false;
    commands: string[] = [];
    terminated = false;
    searching = false;
    constructor(public url: string) {
        super();
        SearchWorker.workers.push(this);
    }
    emit(line: string) {
        this.dispatchEvent(new MessageEvent("message", { data: line }));
    }
    complete() {
        this.searching = false;
        this.emit("bestmove e2e4");
    }
    postMessage(command: string) {
        this.commands.push(command);
        queueMicrotask(() => {
            if (this.terminated) return;
            if (command === "uci" && !SearchWorker.holdHandshake) {
                this.emit("id name Stockfish 19 Lite fixture");
                this.emit("uciok");
            }
            if (command === "isready") this.emit("readyok");
            if (command === "stop" && this.searching && SearchWorker.acknowledgeStop)
                this.complete();
            if (command.startsWith("go ")) {
                this.searching = true;
                const depth = Number(/^go depth (\d+)$/.exec(command)?.[1] ?? 8);
                this.emit(`info depth ${depth} multipv 1 nodes 800 score cp 12 pv e2e4 e7e5`);
                if (SearchWorker.finish) this.complete();
            }
        });
    }
    terminate() {
        this.terminated = true;
    }
}
let api: typeof import("../stockfishEngine");
const worker = () => SearchWorker.workers.at(-1)!;
const go = () => worker()?.commands.filter((command) => command.startsWith("go ")) ?? [];
const stops = () => worker().commands.filter((command) => command === "stop").length;
const request = (searchLimit: EngineSearchLimit, signal?: AbortSignal) =>
    api.analyzeWithWebStockfish18({ fen, multipv: 1, depth: 14, searchLimit, signal });
beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VITE_EN_CROISSANT_STOCKFISH_URL", "");
    vi.stubGlobal("Worker", SearchWorker);
    SearchWorker.workers = [];
    SearchWorker.finish = true;
    SearchWorker.acknowledgeStop = true;
    SearchWorker.holdHandshake = false;
    api = await import("../stockfishEngine");
});
afterEach(async () => {
    api.stopWebStockfish18Search();
    await Promise.resolve();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});
it.each([
    ["depth", 6, "go depth 6"],
    ["time", 51, "go movetime 51"],
    ["nodes", 333, "go nodes 333"],
] as const)(
    "uses an exact %s command in the managed phone engine",
    async (mode, value, command) => {
        const lines = await request({ version: 1, mode, value });
        expect(go()).toEqual([command]);
        expect(lines[0]).toMatchObject({
            source: "stockfish",
            executionLocation: "phone",
            engineName: "Stockfish 19 Lite fixture",
        });
    },
);
it.each([
    { version: 1, mode: "infinite" },
    { version: 1, mode: "nodes", value: 4294967295 },
    { version: 1, mode: "time", value: 3600000 },
] as const)(
    "keeps the selected $mode search beyond the legacy deadline until its own cancellation",
    async (limit) => {
        vi.useFakeTimers();
        SearchWorker.finish = false;
        const controller = new AbortController();
        let settled = false;
        const pending = request(limit, controller.signal).then(
            (value) => {
                settled = true;
                return value;
            },
            (error) => {
                settled = true;
                return error;
            },
        );
        await vi.waitFor(() => expect(go()).toHaveLength(1));
        const baseline = stops();
        await vi.advanceTimersByTimeAsync(180001);
        expect(settled).toBe(false);
        expect(stops()).toBe(baseline);
        controller.abort();
        expect(await pending).toMatchObject({ name: "AbortError" });
        expect(vi.getTimerCount()).toBe(0);
    },
);
it("holds a successor until the replaced search acknowledges stop, then ignores the old abort", async () => {
    SearchWorker.finish = false;
    SearchWorker.acknowledgeStop = false;
    const old = new AbortController(),
        current = new AbortController();
    const first = request({ version: 1, mode: "infinite" }, old.signal).catch((error) => error);
    await vi.waitFor(() => expect(go()).toHaveLength(1));
    const next = request({ version: 1, mode: "nodes", value: 1000 }, current.signal).catch(
        (error) => error,
    );
    try {
        for (let tick = 0; tick < 20; tick++) await Promise.resolve();
        expect(go()).toHaveLength(1);
        worker().complete();
        expect(await first).toMatchObject({ name: "AbortError" });
        await vi.waitFor(() => expect(go()).toHaveLength(2));
        const baseline = stops();
        old.abort();
        await Promise.resolve();
        expect(stops()).toBe(baseline);
        worker().complete();
        expect((await next)[0].executionLocation).toBe("phone");
    } finally {
        old.abort();
        current.abort();
        worker().complete();
        await Promise.all([first, next]);
    }
});
it("cancels a queued request without letting its successor bypass the active worker", async () => {
    SearchWorker.finish = false;
    SearchWorker.acknowledgeStop = false;
    const first = request({ version: 1, mode: "infinite" }).catch((error) => error);
    await vi.waitFor(() => expect(go()).toHaveLength(1));
    const queued = request({ version: 1, mode: "time", value: 1000 }).catch((error) => error);
    const last = request({ version: 1, mode: "depth", value: 6 });
    expect(await queued).toMatchObject({ name: "AbortError" });
    expect(go()).toHaveLength(1);
    worker().complete();
    expect(await first).toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(go()).toEqual(["go infinite", "go depth 6"]));
    worker().complete();
    await last;
});
it("does not let an already-cancelled request stop current work", async () => {
    SearchWorker.finish = false;
    const running = request({ version: 1, mode: "infinite" });
    await vi.waitFor(() => expect(go()).toHaveLength(1));
    const baseline = stops();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
        request({ version: 1, mode: "time", value: 50 }, cancelled.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(stops()).toBe(baseline);
    worker().complete();
    await running;
});
it("rejects a replaced handshake before sending its stale position or limit", async () => {
    SearchWorker.holdHandshake = true;
    const first = request({ version: 1, mode: "time", value: 75 }).catch((error) => error);
    await vi.waitFor(() => expect(worker()).toBeTruthy());
    const next = request({ version: 1, mode: "depth", value: 6 });
    expect(await first).toMatchObject({ name: "AbortError" });
    SearchWorker.holdHandshake = false;
    worker().emit("id name Stockfish 19 Lite fixture");
    worker().emit("uciok");
    await next;
    expect(go()).toEqual(["go depth 6"]);
});
it("uses the time completion allowance and replaces an unresponsive stopped worker before the next search", async () => {
    vi.useFakeTimers();
    SearchWorker.finish = false;
    SearchWorker.acknowledgeStop = false;
    const first = request({ version: 1, mode: "time", value: 50 }).catch((error) => error);
    await vi.waitFor(() => expect(go()).toHaveLength(1));
    const previous = worker();
    await vi.advanceTimersByTimeAsync(10051);
    expect(previous.commands).toContain("stop");
    await vi.advanceTimersByTimeAsync(1001);
    expect((await first).message).toMatch(/too long/);
    expect(previous.terminated).toBe(true);
    SearchWorker.finish = true;
    SearchWorker.acknowledgeStop = true;
    await request({ version: 1, mode: "depth", value: 6 });
    expect(worker()).not.toBe(previous);
});
