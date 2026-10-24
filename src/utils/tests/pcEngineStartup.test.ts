import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getPcEngineBestMoves, type PcEngineAnalysisUpdate } from "../pcEngine";
import { createGamingPcLc0Engine } from "../engines";
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const encoder = new TextEncoder();
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function start() {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: unknown, options?: RequestInit) => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    stream = controller;
                },
            cancel() { closed = true; },
            });
            options?.signal?.addEventListener(
                "abort",
                () => {
                    if (!closed) {
                        closed = true;
                        stream.error(new DOMException("Cancelled", "AbortError"));
                    }
                },
                { once: true },
            );
            return new Response(body, { status: 200 });
        }),
    );
    const update = vi.fn<(value: PcEngineAnalysisUpdate) => void>();
    const controller = new AbortController();
    const promise = getPcEngineBestMoves({
        engine: createGamingPcLc0Engine(),
        goMode: { t: "Depth", c: 20 },
        options: { fen: FEN, moves: [], extraOptions: [{ name: "MultiPV", value: "1" }] },
        signal: controller.signal,
        onUpdate: update,
    });
    const result = promise.then(
        (value) => ({ value, error: null }),
        (error: Error) => ({ value: null, error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    return {
        update,
        controller,
        result,
        send(...values: unknown[]) {
            stream.enqueue(encoder.encode(values.map(value => JSON.stringify(value)).join("\n") + "\n"));
        },
        close() {
            closed = true;
            stream.close();
        },
    };
}

it("coalesces desktop PC startup and flushes done before EOF, ignoring late output", async () => {
    const run = await start();
    run.send({ type: "uci", line: "info depth 1 score cp -1800 pv e2e4" });
    await vi.advanceTimersByTimeAsync(5);
    run.send({ type: "uci", line: "info depth 8 score cp 25 pv e2e4 e7e5" });
    run.send({ type: "uci", line: "info depth 9 score cp 900 lowerbound pv d2d4" });
    await vi.advanceTimersByTimeAsync(494);
    expect(run.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.update).toHaveBeenCalledTimes(1);
    expect(run.update.mock.calls[0][0].lines[0]).toMatchObject({
        depth: 8,
        score: { value: { type: "cp", value: 25 } },
    });
    run.send({ type: "done" }, { type: "uci", line: "info depth 99 score cp 9999 pv d2d4" });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.update.mock.calls.at(-1)?.[0].progress).toBe(100);
    await vi.advanceTimersByTimeAsync(0);
    const final = await run.result;
    expect(final.error).toBeNull();
    expect(final.value?.[1][0]).toMatchObject({ depth: 8, uciMoves: ["e2e4", "e7e5"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.update).toHaveBeenCalledTimes(2);
});

it("does not publish the desktop PC startup buffer after cancellation", async () => {
    const run = await start();
    run.send({ type: "uci", line: "info depth 1 score cp 900 pv e2e4" });
    await vi.advanceTimersByTimeAsync(10);
    run.controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await run.result).error?.name).toBe("AbortError");
    expect(run.update).not.toHaveBeenCalled();
});
