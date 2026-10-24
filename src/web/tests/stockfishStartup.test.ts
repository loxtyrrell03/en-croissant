import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analyzeWithWebStockfish18, stopWebStockfish18Search } from "../stockfishEngine";
import type { WebEngineLine } from "../model";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const NEXT_FEN = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
const encoder = new TextEncoder();
type Stream = { send: (line: string) => void; done: (close?: boolean, lateLine?: string) => void; close: () => void };
let streams: Map<string, Stream>;
beforeEach(() => {
    vi.useFakeTimers();
    streams = new Map();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
            const url = String(input);
            if (url.includes("/v1/cloud-eval")) return new Response("{}", { status: 404 });
            if (url.includes("/api/engine/start")) return new Response("{}", { status: 200 });
            if (!url.includes("/v1/analyze")) throw new Error(`Unexpected fixture request: ${url}`);
            const fen = JSON.parse(options!.body as string).fen;
            let control!: ReadableStreamDefaultController<Uint8Array>;
            let closed = false;
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    control = controller;
                },
                cancel() { closed = true; },
            });
            const write = (value: unknown) =>
                control.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
            options?.signal?.addEventListener(
                "abort",
                () => {
                    if (!closed) {
                        closed = true;
                        control.error(new DOMException("Cancelled", "AbortError"));
                    }
                },
                { once: true },
            );
            streams.set(fen, {
                send(line) {
                    write({ type: "uci", line });
                },
                done(close = true, lateLine?: string) {
                    const frames: unknown[] = [{ type: "done", bestmove: "e2e4" }];
                    if (lateLine) frames.push({ type: "uci", line: lateLine });
                    control.enqueue(encoder.encode(frames.map(frame => JSON.stringify(frame)).join("\n") + "\n"));
                    if (close) {
                        closed = true;
                        control.close();
                    }
                },
                close() {
                    closed = true;
                    control.close();
                },
            });
            return new Response(body, { status: 200 });
        }),
    );
});
afterEach(() => {
    stopWebStockfish18Search();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
async function start(fen = FEN, signal?: AbortSignal) {
    const update = vi.fn<(lines: WebEngineLine[]) => void>();
    const result = analyzeWithWebStockfish18({
        fen,
        multipv: 1,
        depth: 20,
        onUpdate: update,
        signal,
    });
    // Attach rejection ownership immediately; aborted fixture streams never leak
    // an unhandled rejection while the test advances the publication clock.
    const settled = result.then(
        (lines) => ({ lines, error: null }),
        (error: Error) => ({ lines: null, error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const stream = streams.get(fen);
    if (!stream) throw new Error("The real analysis transport did not open its fixture stream");
    return { update, stream, settled };
}

it("coalesces startup and rejects bound scores in the actual phone live transport", async () => {
    const run = await start();
    run.stream.send("info depth 1 score cp -1800 pv e2e4");
    await vi.advanceTimersByTimeAsync(5);
    run.stream.send("info depth 8 score cp 25 pv e2e4 e7e5");
    for (const score of [
        "cp 900 lowerbound",
        "cp -900 upperbound",
        "mate 3 lowerbound",
        "mate -3 upperbound",
    ])
        run.stream.send(`info depth 9 score ${score} pv e2e4 e7e5`);
    await vi.advanceTimersByTimeAsync(114);
    expect(run.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.update).toHaveBeenCalledTimes(1);
    expect(run.update.mock.calls[0][0][0]).toMatchObject({
        depth: 8,
        score: { type: "cp", value: 25 },
    });
    run.stream.done();
    await vi.advanceTimersByTimeAsync(0);
    const final = await run.settled;
    expect(final.error).toBeNull();
    expect(final.lines?.[0].score).toEqual({ type: "cp", value: 25 });
});

it("immediately publishes a completed short search without a later shallow flash", async () => {
    const run = await start();
    run.stream.send("info depth 1 score cp 900 pv e2e4");
    run.stream.send("info depth 8 score cp 24 pv e2e4 e7e5");
    run.stream.done(false, "info depth 99 score cp 9999 pv d2d4");
    await vi.advanceTimersByTimeAsync(0);
    expect(run.update).toHaveBeenCalledTimes(1);
    expect(run.update.mock.calls[0][0][0].depth).toBe(8);
    await vi.advanceTimersByTimeAsync(0);
    const final = await run.settled;
    expect(final.error).toBeNull();
    expect(final.lines?.[0]).toMatchObject({ depth: 8, score: { type: "cp", value: 24 } });
    await vi.advanceTimersByTimeAsync(500);
    expect(run.update).toHaveBeenCalledTimes(1);
});

it("drops an aborted search's pending publication", async () => {
    const controller = new AbortController();
    const run = await start(FEN, controller.signal);
    run.stream.send("info depth 1 score cp 900 pv e2e4");
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect((await run.settled).error?.name).toBe("AbortError");
    expect(run.update).not.toHaveBeenCalled();
});

it("retargets before startup publication and keeps only the new position", async () => {
    const previous = await start();
    previous.stream.send("info depth 1 score cp 900 pv e2e4");
    await vi.advanceTimersByTimeAsync(10);
    const next = await start(NEXT_FEN);
    next.stream.send("info depth 12 score cp 20 pv d7d5 c2c4");
    await vi.advanceTimersByTimeAsync(120);
    expect(previous.update).not.toHaveBeenCalled();
    expect((await previous.settled).error?.name).toBe("AbortError");
    expect(next.update.mock.calls[0][0][0]).toMatchObject({
        depth: 12,
        uciMoves: ["d7d5", "c2c4"],
        score: { type: "cp", value: -20 },
    });
    next.stream.done();
    await vi.advanceTimersByTimeAsync(0);
    expect((await next.settled).error).toBeNull();
});
