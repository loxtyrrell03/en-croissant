// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Request = {
    result: unknown;
    error: Error | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
};
const request = (): Request => ({
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
});
function storageFixture() {
    const opens: Request[] = [],
        transactions: Array<{
            request: Request;
            oncomplete: (() => void) | null;
            onabort: (() => void) | null;
            error: Error | null;
            abort: () => void;
        }> = [];
    const close = vi.fn();
    const database = {
        close,
        onclose: null as (() => void) | null,
        onversionchange: null as (() => void) | null,
        transaction() {
            const read = request();
            const tx = {
                request: read,
                oncomplete: null as (() => void) | null,
                onabort: null as (() => void) | null,
                error: null as Error | null,
                abort: vi.fn(() => tx.onabort?.()),
                objectStore: () => ({ get: () => read, put: () => read }),
            };
            transactions.push(tx);
            return tx;
        },
    };
    vi.stubGlobal("indexedDB", {
        open: vi.fn(() => {
            const next = request();
            next.result = database;
            opens.push(next);
            return next;
        }),
    });
    return { opens, transactions, database, close };
}
beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it("retries a failed open instead of reusing its rejected promise", async () => {
    const fixture = storageFixture();
    const { loadWebState } = await import("../storage");
    const failed = loadWebState().catch((error) => error);
    fixture.opens[0].error = new Error("Example denied");
    fixture.opens[0].onerror!();
    expect(await failed).toMatchObject({ message: "Example denied" });
    const retry = loadWebState();
    expect(fixture.opens).toHaveLength(2);
    fixture.opens[1].onsuccess!();
    await Promise.resolve();
    fixture.transactions[0].request.onsuccess!();
    fixture.transactions[0].oncomplete!();
    expect((await retry).databases).toEqual([]);
});
it("a blocked or expired open remains retryable and closes a late connection", async () => {
    const fixture = storageFixture();
    const { loadWebState } = await import("../storage");
    const blocked = loadWebState().catch((error) => error);
    fixture.opens[0].onblocked!();
    expect((await blocked).message).toContain("Another tab");
    fixture.opens[0].onsuccess!();
    expect(fixture.close).toHaveBeenCalledTimes(1);
    const expired = loadWebState().catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await expired).message).toContain("too long");
    fixture.opens[1].onsuccess!();
    expect(fixture.close).toHaveBeenCalledTimes(2);
});
it("does not resolve a save at request success, and surfaces a later transaction abort", async () => {
    const fixture = storageFixture();
    const { saveWebState, createEmptyWebState } = await import("../storage");
    let resolved = false;
    const pending = saveWebState(createEmptyWebState())
        .then(() => {
            resolved = true;
        })
        .catch((error) => error);
    fixture.opens[0].onsuccess!();
    await Promise.resolve();
    fixture.transactions[0].request.onsuccess!();
    await Promise.resolve();
    expect(resolved).toBe(false);
    fixture.transactions[0].abort();
    expect((await pending).message).toContain("could not finish");
    expect(resolved).toBe(false);
});
it("aborts a stalled transaction and reopens after a connection version change", async () => {
    const fixture = storageFixture();
    const { loadWebState } = await import("../storage");
    const pending = loadWebState().catch((error) => error);
    fixture.opens[0].onsuccess!();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.transactions[0].abort).toHaveBeenCalledTimes(1);
    expect(await pending).toBeInstanceOf(Error);
    fixture.database.onversionchange!();
    expect(fixture.close).toHaveBeenCalledTimes(1);
    const next = loadWebState();
    expect(fixture.opens).toHaveLength(2);
    fixture.opens[1].onsuccess!();
    await Promise.resolve();
    fixture.transactions[1].request.onsuccess!();
    fixture.transactions[1].oncomplete!();
    await next;
});
