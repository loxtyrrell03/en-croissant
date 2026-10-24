import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { coalescedUpdates } from "../coalescedUpdates";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("replaces a shallow startup burst and publishes a quiet stream on its timer", async () => {
    const publish = vi.fn();
    const output = coalescedUpdates(publish, () => true, 120);
    output.push(-1800);
    await vi.advanceTimersByTimeAsync(5);
    output.push(25);
    await vi.advanceTimersByTimeAsync(114);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledExactlyOnceWith(25);
});
it("retains the newest update without extending each publication window", async () => {
    const publish = vi.fn();
    const output = coalescedUpdates(publish, () => true, 120);
    for (let n = 0; n < 24; n++) {
        output.push(n);
        await vi.advanceTimersByTimeAsync(10);
    }
    expect(publish.mock.calls).toEqual([[11], [23]]);
    output.cancel();
});
it("flushes a short completed search immediately and cancels its timer", async () => {
    const publish = vi.fn();
    const output = coalescedUpdates(publish, () => true, 120);
    output.push(900);
    output.finish(24);
    expect(publish).toHaveBeenCalledExactlyOnceWith(24);
    await vi.advanceTimersByTimeAsync(500);
    output.push(25);
    expect(publish).toHaveBeenCalledTimes(1);
});
it.each(["cancel", "retarget"])("does not publish a pending result after %s", async (reason) => {
    const publish = vi.fn();
    let current = true;
    const output = coalescedUpdates(publish, () => current, 120);
    output.push(900);
    if (reason === "cancel") output.cancel();
    else current = false;
    await vi.advanceTimersByTimeAsync(500);
    output.finish(25);
    expect(publish).not.toHaveBeenCalled();
});
