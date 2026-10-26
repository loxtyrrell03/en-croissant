import { afterEach, expect, it, vi } from "vitest";
import { assertPcCpuReceipt, loadPcCpuCapability, parsePcCpuCapability } from "../pcCpuResources";
const capability = {
    resourceProtocolVersion: 1,
    device: { logicalThreads: 20, totalMemoryMb: 32768, availableMemoryMb: 24000 },
    cpuResources: { threads: { min: 1, max: 64 }, hashMb: { min: 16, max: 8192 } },
};
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it("requires explicit apply capability and PC hardware, keeping unknown memory distinct from zero", () => {
    expect(parsePcCpuCapability(capability).device).toEqual(capability.device);
    expect(() => parsePcCpuCapability({ device: capability.device })).toThrow(/update/);
    expect(() => parsePcCpuCapability({ ...capability, resourceProtocolVersion: 2 })).toThrow(
        /update/,
    );
    expect(() =>
        parsePcCpuCapability({ ...capability, cpuResources: { threads: { min: 1, max: 9999 } } }),
    ).toThrow(/bounds/);
    expect(
        parsePcCpuCapability({ ...capability, device: { logicalThreads: 4 } }).device.totalMemoryMb,
    ).toBeNull();
    expect(
        parsePcCpuCapability({
            ...capability,
            device: { ...capability.device, availableMemoryMb: 0 },
        }).device.availableMemoryMb,
    ).toBe(0);
});
it("reads only health, never starts a service, and bounds an unresponsive fetch", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
        (_url: RequestInfo | URL, _options?: RequestInit) => new Promise<Response>(() => {}),
    );
    vi.stubGlobal("fetch", fetch);
    const result = loadPcCpuCapability(undefined, "http://fixture").catch((error) => error);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await result).message).toMatch(/timed out/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("http://fixture/v1/health");
    expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
});
it("cancels even an ignored transport and clears its timer on an owned successful read", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
        (_url: RequestInfo | URL, _options?: RequestInit) => new Promise<Response>(() => {}),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = loadPcCpuCapability(controller.signal, "http://fixture").catch((error) => error);
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(capability)));
    await expect(loadPcCpuCapability(undefined, "http://fixture")).resolves.toMatchObject({
        device: capability.device,
    });
    expect(vi.getTimerCount()).toBe(0);
});
it("requires both the resource receipt and actual top-level effective values to match", () => {
    const selected = { version: 1 as const, threads: 3, hashMb: 333 };
    const meta = {
        engineKind: "stockfish",
        resourceProtocolVersion: 1,
        cpuResources: selected,
        threads: 3,
        hashMb: 333,
    };
    expect(() => assertPcCpuReceipt(meta, selected)).not.toThrow();
    for (const message of [
        {},
        { ...meta, hashMb: 1024 },
        { ...meta, resourceProtocolVersion: 0 },
        { ...meta, cpuResources: { ...selected, threads: 1 } },
    ])
        expect(() => assertPcCpuReceipt(message, selected)).toThrow(/CPU resources/);
});
