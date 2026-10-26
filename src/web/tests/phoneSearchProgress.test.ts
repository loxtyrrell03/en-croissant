import { expect, it } from "vitest";
import { phoneSearchProgress, phoneSearchSummary } from "../phoneSearchProgress";
import type { WebEngineLine } from "../model";
const line: WebEngineLine = {
    source: "stockfish",
    executionLocation: "gaming-pc",
    multipv: 1,
    depth: 8,
    score: { type: "cp", value: 20 },
    uciMoves: ["e2e4"],
    sanMoves: ["e4"],
};
it("does not turn a stored evaluation or missing engine time into search progress", () => {
    expect(
        phoneSearchProgress(true, "running", [{ ...line, source: "lichess-cloud", depth: 65 }], {
            t: "Depth",
            c: 14,
        }).value,
    ).toBeNull();
    expect(phoneSearchProgress(true, "running", [line], { t: "Time", c: 1000 }).value).toBeNull();
    expect(phoneSearchProgress(true, "running", [line], { t: "Nodes", c: 1000 }).value).toBeNull();
});
it("uses actual time/nodes/depth with labels and never reports completion before done", () => {
    expect(
        phoneSearchProgress(true, "running", [{ ...line, timeMs: 500 }], { t: "Time", c: 1000 }),
    ).toMatchObject({ value: 50, label: expect.stringContaining("500 ms") });
    expect(
        phoneSearchProgress(true, "running", [{ ...line, nodes: 1500 }], { t: "Nodes", c: 1000 })
            .value,
    ).toBe(99);
    expect(phoneSearchProgress(true, "running", [line], { t: "Depth", c: 16 })).toEqual({
        value: 50,
        label: "Depth 8 of 16",
    });
    expect(phoneSearchProgress(true, "complete", [line], { t: "Depth", c: 16 }).value).toBe(100);
});
it("distinguishes paused/error/unlimited states and preserves subsecond units", () => {
    expect(phoneSearchProgress(false, "running", [line], { t: "Depth", c: 14 })).toEqual({
        value: 0,
        label: "Analysis paused",
    });
    expect(phoneSearchProgress(true, "error", [line], { t: "Time", c: 1000 })).toEqual({
        value: 0,
        label: "Analysis unavailable",
    });
    expect(phoneSearchProgress(true, "running", [line], { t: "Infinite" }).value).toBeNull();
    expect(phoneSearchSummary({ t: "Time", c: 51 })).toBe("51 ms per position");
    expect(phoneSearchSummary({ t: "Time", c: 1234 })).toBe("1.234 s per position");
});
it("ignores invalid engine counters rather than presenting missing data as zero", () => {
    for (const timeMs of [null, NaN, Infinity, -1])
        expect(
            phoneSearchProgress(true, "running", [{ ...line, timeMs }], { t: "Time", c: 1000 })
                .value,
        ).toBeNull();
    expect(
        phoneSearchProgress(true, "running", [{ ...line, timeMs: 0 }], { t: "Time", c: 1000 })
            .value,
    ).toBe(0);
});
