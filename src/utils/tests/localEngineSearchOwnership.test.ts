import { expect, it } from "vitest";
import {
    ownedEngineReply,
    queueLocalEngineStop,
    waitForLocalEngineStops,
} from "../localEngineSearchOwnership";
it("waits for all cleanup for one native identity without blocking another", async () => {
    let first!: () => void, second!: () => void;
    const a = queueLocalEngineStop(
        "a",
        "tab",
        () =>
            new Promise<void>((done) => {
                first = done;
            }),
    );
    const b = queueLocalEngineStop(
        "a",
        "tab",
        () =>
            new Promise<void>((done) => {
                second = done;
            }),
    );
    let started = false;
    const ready = waitForLocalEngineStops("a", "tab").then(() => {
        started = true;
    });
    await waitForLocalEngineStops("other", "tab");
    expect(started).toBe(false);
    first();
    await a;
    await Promise.resolve();
    expect(started).toBe(false);
    second();
    await b;
    await ready;
    expect(started).toBe(true);
});
it("cancels a waiter and bounds an unknown stop without treating it as completed", async () => {
    let finish!: () => void;
    const stop = queueLocalEngineStop(
        "bounded",
        "tab",
        () =>
            new Promise<void>((done) => {
                finish = done;
            }),
    );
    const controller = new AbortController();
    const waiting = waitForLocalEngineStops("bounded", "tab", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await expect(waitForLocalEngineStops("bounded", "tab", undefined, 10)).rejects.toThrow(
        "stop request",
    );
    finish();
    await stop;
    await waitForLocalEngineStops("bounded", "tab");
});
it("aborted consumers ignore late replies and rejected cleanup does not poison future work", async () => {
    let finish!: (value: number) => void;
    const promise = new Promise<number>((done) => {
        finish = done;
    });
    const controller = new AbortController();
    const waiting = ownedEngineReply(promise, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    finish(1);
    await expect(
        queueLocalEngineStop("failed", "tab", async () => {
            throw new Error("Invented RPC failure");
        }),
    ).rejects.toThrow("RPC failure");
    await waitForLocalEngineStops("failed", "tab");
});
