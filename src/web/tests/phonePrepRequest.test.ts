import { afterEach, expect, test, vi } from "vitest";
import {
    readPhonePrepRequest,
    watchPhonePrepRequests,
    phoneBoardHasUnfiledAnalysis,
} from "../phonePrepRequest";
import { createEmptyWebState } from "../storage";

afterEach(() => vi.useRealTimers());
test("defers switching a standalone analysis line while saved Prep lines remain recoverable", () => {
    const state = createEmptyWebState();
    expect(phoneBoardHasUnfiledAnalysis(state)).toBe(false);
    state.board.line = [{ san: "e4" } as (typeof state.board.line)[number]];
    expect(phoneBoardHasUnfiledAnalysis(state)).toBe(true);
    state.activePrepId = "saved-prep";
    expect(phoneBoardHasUnfiledAnalysis(state)).toBe(false);
});
const request = { id: "example-1", jobId: "otb-example", userColor: "black" as const };
test("rejects malformed requests and accepts an explicit user side", () => {
    expect(readPhonePrepRequest(request)).toEqual(request);
    for (const value of [
        null,
        { ...request, id: "" },
        { ...request, jobId: "../file" },
        { ...request, userColor: "opponent" },
    ])
        expect(readPhonePrepRequest(value)).toBeNull();
});
test("picks up a home-screen request once, then accepts a newer request on resume", async () => {
    vi.useFakeTimers();
    let current = request;
    let saved: string | undefined;
    const apply = vi.fn(async (r) => {
        saved = r.id;
    });
    const load = vi.fn(async () => current);
    const stop = watchPhonePrepRequests({ apply, load, appliedId: () => saved, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(apply).toHaveBeenCalledTimes(1);
    current = { ...request, id: "example-2" };
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(apply).toHaveBeenCalledTimes(2);
});
test("does not acknowledge a failed save and retries without repeating its error notification", async () => {
    vi.useFakeTimers();
    let saved: string | undefined;
    const apply = vi
        .fn()
        .mockRejectedValueOnce(new Error("Example storage full"))
        .mockImplementation(async (r) => {
            saved = r.id;
        });
    const onError = vi.fn();
    const stop = watchPhonePrepRequests({
        apply,
        appliedId: () => saved,
        onError,
        load: async () => request,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saved).toBe(request.id);
    expect(apply).toHaveBeenCalledTimes(2);
    stop();
});
test("keeps checks serialized and aborts a pending read when the app closes", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const load = vi.fn((s) => {
        signal = s;
        return new Promise<null>(() => {});
    });
    const stop = watchPhonePrepRequests({
        apply: vi.fn(),
        appliedId: () => undefined,
        onError: vi.fn(),
        load,
    });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    stop();
    expect(signal?.aborted).toBe(true);
});
