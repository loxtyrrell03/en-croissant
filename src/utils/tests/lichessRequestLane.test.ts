import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    LICHESS_REQUEST_SPACING_MS,
    lichessBackoffRemaining,
    noteLichessRateLimit,
    queueLichessRequest,
    resetLichessRequestLaneForTests,
} from "../lichess/requestLane";

beforeEach(() => {
    resetLichessRequestLaneForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00Z"));
});

afterEach(() => {
    resetLichessRequestLaneForTests();
    vi.useRealTimers();
});

describe("Lichess request lane", () => {
    test("serializes and spaces request starts", async () => {
        const starts: number[] = [];
        const request = () =>
            queueLichessRequest(async () => {
                starts.push(Date.now());
            });
        const first = request();
        const second = request();
        await first;
        expect(starts).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(LICHESS_REQUEST_SPACING_MS);
        await second;
        expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(LICHESS_REQUEST_SPACING_MS);
    });

    test("runs interactive work before queued background work", async () => {
        let release!: () => void;
        const order: string[] = [];
        const active = queueLichessRequest(
            () =>
                new Promise<void>((resolve) => {
                    order.push("active");
                    release = resolve;
                }),
            { priority: "background" },
        );
        await Promise.resolve();
        const background = queueLichessRequest(async () => order.push("background"), {
            priority: "background",
        });
        const interactive = queueLichessRequest(async () => order.push("interactive"), {
            priority: "interactive",
        });
        release();
        await active;
        await vi.advanceTimersByTimeAsync(LICHESS_REQUEST_SPACING_MS);
        await interactive;
        expect(order).toEqual(["active", "interactive"]);
        await vi.advanceTimersByTimeAsync(LICHESS_REQUEST_SPACING_MS);
        await background;
    });

    test("honours numeric and HTTP-date Retry-After values for at least one minute", () => {
        const now = Date.parse("2026-08-31T12:00:00Z");
        noteLichessRateLimit("2", now);
        expect(lichessBackoffRemaining(now + 59_999)).toBe(1);
        noteLichessRateLimit("Mon, 31 Aug 2026 12:02:00 GMT", now);
        expect(lichessBackoffRemaining(now + 119_999)).toBe(1);
        expect(lichessBackoffRemaining(now + 120_000)).toBe(0);
    });

    test("removes a cancelled queued request", async () => {
        let release!: () => void;
        const active = queueLichessRequest(
            () => new Promise<void>((resolve) => (release = resolve)),
        );
        await Promise.resolve();
        const controller = new AbortController();
        const stale = queueLichessRequest(async () => 1, { signal: controller.signal });
        controller.abort();
        await expect(stale).rejects.toMatchObject({ name: "AbortError" });
        release();
        await active;
    });
});
