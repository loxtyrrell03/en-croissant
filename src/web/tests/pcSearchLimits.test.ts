import { afterEach, expect, it, vi } from "vitest";
import {
    parsePcSearchCapability,
    assertPcSearchCapability,
    capturePcSearchLimit,
    assertPcSearchReceipt,
    loadPcSearchCapability,
} from "../pcSearchLimits";
const capability = {
    searchProtocolVersion: 1,
    searchLimits: {
        depth: { min: 1, max: 70 },
        timeMs: { min: 50, max: 3600000 },
        nodes: { min: 1, max: 4294967295 },
        infinite: true,
    },
};
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it("requires explicit search support independently of device and CPU capability", () => {
    expect(parsePcSearchCapability(capability)).toEqual(capability.searchLimits);
    for (const value of [
        {},
        { resourceProtocolVersion: 1, device: { logicalThreads: 20 } },
        { ...capability, searchProtocolVersion: 2 },
        { ...capability, searchLimits: { ...capability.searchLimits, infinite: false } },
        {
            ...capability,
            searchLimits: { ...capability.searchLimits, timeMs: { min: 0, max: 3600000 } },
        },
    ])
        expect(() => parsePcSearchCapability(value)).toThrow(/update|valid/);
    const parsed = parsePcSearchCapability(capability);
    parsed.depth.max = 6;
    expect(capability.searchLimits.depth.max).toBe(70);
});
it("keeps exact selections immutable and checks a narrower advertised range", () => {
    const selected = { version: 1 as const, mode: "time" as const, value: 51 };
    const captured = capturePcSearchLimit(selected);
    selected.value = 100;
    expect(captured).toEqual({ version: 1, mode: "time", value: 51 });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(() =>
        assertPcSearchCapability(
            {
                ...capability,
                searchLimits: { ...capability.searchLimits, timeMs: { min: 100, max: 1000 } },
            },
            captured,
        ),
    ).toThrow(/range/);
    expect(() => capturePcSearchLimit({ version: 1, mode: "time", value: "50" })).toThrow(
        /invalid/,
    );
});
it("requires the same engine, protocol, selection and effective UCI command", () => {
    const selected = { version: 1 as const, mode: "time" as const, value: 55 };
    const receipt = {
        engineKind: "lc0",
        searchProtocolVersion: 1,
        searchLimit: selected,
        searchCommand: "go movetime 55",
    };
    expect(() => assertPcSearchReceipt(receipt, selected, "lc0")).not.toThrow();
    for (const value of [
        {},
        { ...receipt, engineKind: "stockfish" },
        { ...receipt, searchProtocolVersion: 2 },
        { ...receipt, searchCommand: "go depth 55" },
        { ...receipt, searchLimit: { ...selected, value: 56 } },
    ])
        expect(() => assertPcSearchReceipt(value, selected, "lc0")).toThrow(/search limit/);
});
it("only reads health, bounds an ignored transport and clears owned cancellation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
        (_input: RequestInfo | URL, _options?: RequestInit) => new Promise<Response>(() => {}),
    );
    vi.stubGlobal("fetch", fetch);
    const result = loadPcSearchCapability().catch((error) => error);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await result).message).toMatch(/timed out/);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/v1\/health$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const aborted = loadPcSearchCapability(controller.signal).catch((error) => error);
    controller.abort();
    expect(await aborted).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(capability)));
    await expect(loadPcSearchCapability()).resolves.toEqual(capability.searchLimits);
    expect(vi.getTimerCount()).toBe(0);
});
