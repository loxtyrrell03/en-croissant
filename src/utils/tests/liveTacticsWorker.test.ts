import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildLiveTacticalScan, type LiveTacticalScanInput } from "../tacticalMotifs/liveTactics";
import {
    classifyLiveTacticsInWorker,
    TACTICAL_CLASSIFICATION_TIMEOUT_MS,
} from "../tacticalMotifs/liveTacticsWorker";

const input: LiveTacticalScanInput = {
    fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
    pvUci: ["e5f7", "d8e8", "f7h8"],
    pvSan: ["Nxf7", "Qe8", "Nxh8"],
    engineName: "Regression",
    depth: 16,
};
class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
        FakeWorker.instances.push(this);
    }
}
beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
const latest = () => FakeWorker.instances.at(-1)!;

test("worker success preserves the actual f7 fork and stops the worker and timer", async () => {
    const result = classifyLiveTacticsInWorker(input, new AbortController().signal);
    const scan = buildLiveTacticalScan(input);
    expect(latest().postMessage).toHaveBeenCalledWith(input);
    latest().onmessage!({ data: { ok: true, scan } });
    expect(await result).toEqual(scan);
    expect(scan.motifs[0].id).toBe("fork");
    expect(latest().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

test("a hung proof is terminated at the deadline and is not an empty successful scan", async () => {
    const result = classifyLiveTacticsInWorker(input, new AbortController().signal);
    const rejected = result.catch((error) => error);
    await vi.advanceTimersByTimeAsync(TACTICAL_CLASSIFICATION_TIMEOUT_MS - 1);
    expect(latest().terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await rejected).toMatchObject({
        message: expect.stringContaining("exceeded 3 seconds"),
    });
    expect(latest().terminate).toHaveBeenCalledTimes(1);
});

test("position changes cancel CPU work and ignore even an already queued old result", async () => {
    const controller = new AbortController();
    const old = classifyLiveTacticsInWorker(input, controller.signal);
    const rejected = old.catch((error) => error);
    const worker = latest();
    const queued = worker.onmessage!;
    controller.abort();
    queued({ data: { ok: true, scan: buildLiveTacticalScan(input) } });
    expect(await rejected).toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const next = classifyLiveTacticsInWorker(input, new AbortController().signal);
    latest().onmessage!({ data: { ok: false, error: "new request" } });
    await expect(next).rejects.toThrow("new request");
});

test("an already cancelled request never starts a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(classifyLiveTacticsInWorker(input, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
    });
    expect(FakeWorker.instances).toHaveLength(0);
});

test.each(["exception", "crash", "deserialize"])(
    "%s leaves a rejected result, never a spinner or fake empty scan",
    async (kind) => {
        const result = classifyLiveTacticsInWorker(input, new AbortController().signal);
        if (kind === "exception")
            latest().onmessage!({ data: { ok: false, error: "proof failed" } });
        if (kind === "crash") latest().onerror!();
        if (kind === "deserialize") latest().onmessageerror!();
        await expect(result).rejects.toThrow(
            kind === "exception" ? "proof failed" : "tactical verification",
        );
        expect(latest().terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    },
);

test("a failed post terminates its worker", async () => {
    class BrokenPost extends FakeWorker {
        postMessage = vi.fn(() => {
            throw new Error("Cannot clone");
        });
    }
    vi.stubGlobal("Worker", BrokenPost);
    await expect(classifyLiveTacticsInWorker(input, new AbortController().signal)).rejects.toThrow(
        "Cannot clone",
    );
    expect(latest().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

test("an unavailable worker fails without running the classifier on the UI thread", async () => {
    vi.stubGlobal(
        "Worker",
        class {
            constructor() {
                throw new Error("Worker blocked");
            }
        },
    );
    await expect(classifyLiveTacticsInWorker(input, new AbortController().signal)).rejects.toThrow(
        "Worker blocked",
    );
    expect(vi.getTimerCount()).toBe(0);
});
