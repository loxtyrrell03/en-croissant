import { afterEach, describe, expect, it, vi } from "vitest";
import { registerJob } from "../jobs";

const stops: Array<() => void> = [];
afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("tournament maintenance cadence", () => {
    it("waits the full interval after completion, even if browser storage is unavailable", async () => {
        vi.useFakeTimers();
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("Storage denied");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("Storage denied");
        });
        let complete!: () => void;
        const run = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    complete = resolve;
                }),
        );
        stops.push(registerJob({ id: "cadence", intervalMs: 120_000, run }));
        await vi.advanceTimersByTimeAsync(120_000);
        expect(run).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(run).toHaveBeenCalledOnce();
        complete();
        await vi.advanceTimersByTimeAsync(119_999);
        expect(run).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(2);
        complete();
    });

    it("keeps the interval after a failure instead of retrying on a hot loop", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const run = vi.fn(async () => {
            throw new Error("Temporary failure");
        });
        stops.push(registerJob({ id: "failure", intervalMs: 60_000, run }));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(run).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(run).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("cancels a replaced scheduled callback and respects an explicit stop", async () => {
        vi.useFakeTimers();
        const old = vi.fn(async () => {}),
            replacement = vi.fn(async () => {});
        stops.push(registerJob({ id: "replace", intervalMs: 60_000, run: old }));
        await vi.advanceTimersByTimeAsync(30_000);
        const stop = registerJob({ id: "replace", intervalMs: 60_000, run: replacement });
        stops.push(stop);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(old).not.toHaveBeenCalled();
        expect(replacement).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(replacement).toHaveBeenCalledOnce();
        stop();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(replacement).toHaveBeenCalledOnce();
    });
});
