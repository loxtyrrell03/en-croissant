import { describe, expect, it, vi } from "vitest";
import {
    flushReviewDeckWrites,
    pendingReviewDeck,
    reviewDeckWriteError,
    writeReviewDeck,
} from "../reviewDeckWrites";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const progress = (reviews: number) => ({
    cards: [{ reviews, due: new Date("2026-10-25T10:00:00Z") }],
    logs: Array.from({ length: reviews }, (_, i) => i),
});

describe("retained per-deck review writes", () => {
    it("serializes a slow write, coalesces newer progress and never lets old completion win", async () => {
        const gate = deferred();
        let disk = progress(0);
        const write = vi.fn(async (value: typeof disk) => {
            if (value.cards[0].reviews === 1) await gate.promise;
            disk = value;
            return value;
        });
        const first = writeReviewDeck("C:\\review\\ordered.json", progress(1), write);
        await Promise.resolve();
        const skipped = writeReviewDeck("c:/REVIEW/ordered.json", progress(2), write);
        const latest = progress(3);
        const last = writeReviewDeck("C:/review/ordered.json", latest, write);
        latest.cards[0].reviews = 999;
        expect(write).toHaveBeenCalledTimes(1);
        const pending = pendingReviewDeck<typeof disk>("c:/review/ordered.json")!;
        expect(pending.cards[0].reviews).toBe(3);
        pending.cards[0].reviews = 888;
        gate.resolve();
        await Promise.all([first, skipped, last]);
        expect(write).toHaveBeenCalledTimes(2);
        expect(disk.cards[0].reviews).toBe(3);
        expect(disk.logs).toHaveLength(3);
        expect(disk.cards[0].due).toBeInstanceOf(Date);
        expect(pendingReviewDeck("c:/review/ordered.json")).toBeNull();
    });

    it("retains the newest progress after an earlier write fails, then retries without a new grade", async () => {
        const gate = deferred();
        const write = vi.fn(async (value: ReturnType<typeof progress>) => {
            if (write.mock.calls.length === 1) {
                await gate.promise;
                throw new Error("Disk full");
            }
            return value;
        });
        const first = writeReviewDeck("failed-deck", progress(1), write);
        await Promise.resolve();
        const newest = writeReviewDeck("failed-deck", progress(2), write);
        const results = Promise.allSettled([first, newest]);
        gate.resolve();
        expect((await results).every((result) => result.status === "rejected")).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);
        expect(reviewDeckWriteError("failed-deck")).toBe("Disk full");
        expect(
            pendingReviewDeck<ReturnType<typeof progress>>("failed-deck")?.cards[0].reviews,
        ).toBe(2);
        await flushReviewDeckWrites("failed-deck");
        expect(write).toHaveBeenCalledTimes(2);
        expect(write.mock.calls[1][0].logs).toHaveLength(2);
        expect(reviewDeckWriteError("failed-deck")).toBeNull();
    });

    it("drains edits arriving as a successful write settles", async () => {
        const write = vi.fn(async (value: number) => value);
        const first = writeReviewDeck("settling", 1, write);
        const next = first.then(() => writeReviewDeck("settling", 2, write));
        await Promise.all([next, flushReviewDeckWrites("settling")]);
        expect(write.mock.calls.map(([value]) => value)).toEqual([1, 2]);
        expect(pendingReviewDeck("settling")).toBeNull();
    });

    it("does not block another deck behind a slow writer", async () => {
        const gate = deferred();
        const slow = writeReviewDeck("separate-slow", 1, async (value) => {
            await gate.promise;
            return value;
        });
        await expect(writeReviewDeck("separate-fast", 2, async (value) => value)).resolves.toBe(2);
        gate.resolve();
        await slow;
    });

    it("retains an empty backend rejection without starting a retry loop", async () => {
        const write = vi.fn(async (value: number) => {
            if (write.mock.calls.length === 1) throw undefined;
            return value;
        });
        await expect(writeReviewDeck("empty-rejection", 1, write)).rejects.toThrow(
            "Could not save review progress",
        );
        await Promise.resolve();
        expect(write).toHaveBeenCalledTimes(1);
        expect(pendingReviewDeck("empty-rejection")).toBe(1);
        await flushReviewDeckWrites("empty-rejection");
        expect(write).toHaveBeenCalledTimes(2);
    });

    it("flushes retained progress on page hide and warns before leaving unsaved work", async () => {
        let failing = true;
        const write = vi.fn(async (value: number) => {
            if (failing) throw new Error("Unavailable");
            return value;
        });
        await expect(writeReviewDeck("page-boundary", 1, write)).rejects.toThrow("Unavailable");
        const leaving = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(leaving);
        expect(leaving.defaultPrevented).toBe(true);
        await Promise.resolve();
        failing = false;
        window.dispatchEvent(new Event("pagehide"));
        await flushReviewDeckWrites("page-boundary");
        expect(pendingReviewDeck("page-boundary")).toBeNull();
        const clean = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);
    });
});
