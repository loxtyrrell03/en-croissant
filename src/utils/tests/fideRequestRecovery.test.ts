import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { lookupFidePlayer, resetFideCacheForTests, searchFidePlayers } from "@/utils/fideApi";
import { resetLichessRequestLaneForTests } from "@/utils/lichess/requestLane";
import { resolveFideImportIdentity } from "@/utils/fideImportIdentity";
import { searchWebFidePlayers } from "@/web/otbImport";

const player = { id: 12345, name: "Example, Alex", year: 1990 };
const response = (body: unknown, status = 200, headers?: HeadersInit) =>
    new Response(JSON.stringify(body), { status, headers });
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

beforeEach(() => {
    vi.useFakeTimers();
    resetFideCacheForTests();
    resetLichessRequestLaneForTests();
});
afterEach(() => {
    resetFideCacheForTests();
    resetLichessRequestLaneForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("FIDE request recovery", () => {
    test("failed HTTP and unreadable responses remain errors and never become cached misses", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(response({}, 503))
            .mockResolvedValueOnce(response({ nope: true }))
            .mockResolvedValue(response([player]));
        vi.stubGlobal("fetch", fetch);
        await expect(searchFidePlayers("Example")).rejects.toThrow(/unavailable/);
        const malformed = expect(searchFidePlayers("Example")).rejects.toThrow(/unreadable/);
        await vi.advanceTimersByTimeAsync(500);
        await malformed;
        const retry = searchFidePlayers("Example");
        await vi.advanceTimersByTimeAsync(500);
        expect(await retry).toEqual([expect.objectContaining(player)]);
        expect(fetch).toHaveBeenCalledTimes(3);
    });
    test("only numeric 404 and successful empty name searches count as confirmed misses", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(response({}, 404))
                .mockResolvedValueOnce(response([], 200))
                .mockResolvedValue(response({}, 404)),
        );
        expect(await searchFidePlayers("12345")).toEqual([]);
        const empty = searchFidePlayers("Nobody");
        await vi.advanceTimersByTimeAsync(500);
        expect(await empty).toEqual([]);
        const failed = expect(searchFidePlayers("Elsewhere")).rejects.toThrow(/unavailable/);
        await vi.advanceTimersByTimeAsync(500);
        await failed;
    });
    test("numeric results must identify the requested player", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...player, id: 54321 })));
        await expect(searchFidePlayers("12345")).rejects.toThrow(/unreadable/);
    });
    test("shared readers cancel independently, and the last cancellation releases the request", async () => {
        const reply = deferred<Response>();
        let transportSignal: AbortSignal | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url, init) => {
                transportSignal = init.signal;
                return reply.promise;
            }),
        );
        const left = new AbortController(),
            right = new AbortController();
        const cancelled = expect(lookupFidePlayer("Example", left.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
        const remaining = searchFidePlayers("example", right.signal);
        await vi.advanceTimersByTimeAsync(0);
        left.abort();
        await cancelled;
        expect(transportSignal?.aborted).toBe(false);
        reply.resolve(response([player]));
        expect(await remaining).toHaveLength(1);
    });
    test("last-reader cancellation prevents a late result from replacing a new request", async () => {
        const old = deferred<Response>();
        const fetch = vi
            .fn()
            .mockReturnValueOnce(old.promise)
            .mockResolvedValue(response([{ ...player, id: 54321 }]));
        vi.stubGlobal("fetch", fetch);
        const controller = new AbortController();
        const cancelled = expect(
            searchFidePlayers("Example", controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await cancelled;
        const next = searchFidePlayers("Example");
        await vi.advanceTimersByTimeAsync(500);
        expect((await next)[0].id).toBe(54321);
        old.resolve(response([player]));
        await vi.advanceTimersByTimeAsync(0);
        expect((await searchFidePlayers("Example"))[0].id).toBe(54321);
    });
    test("body stalls time out and free the interactive lane", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(() => {}) })
            .mockResolvedValue(response([player]));
        vi.stubGlobal("fetch", fetch);
        const stalled = expect(searchFidePlayers("Example")).rejects.toThrow(/too long/);
        await vi.advanceTimersByTimeAsync(8000);
        await stalled;
        expect(await searchFidePlayers("Example")).toHaveLength(1);
    });
    test("429 prevents further network requests for at least a minute", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(response({}, 429, { "retry-after": "1" }))
            .mockResolvedValue(response([player]));
        vi.stubGlobal("fetch", fetch);
        await expect(searchFidePlayers("Example")).rejects.toThrow(/minute/);
        await expect(searchFidePlayers("Another")).rejects.toThrow(/minute/);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await searchFidePlayers("Example")).toHaveLength(1);
    });
});

describe("phone FIDE transport", () => {
    test("malformed successful PC replies and wrong numeric identities never become no-match", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(response({}))
                .mockResolvedValueOnce(response({ players: [{ id: -1, name: "Invalid" }] }))
                .mockResolvedValue(response({ players: [{ ...player, id: 54321 }] })),
        );
        await expect(searchWebFidePlayers("Example")).rejects.toThrow(/unreadable/);
        await expect(searchWebFidePlayers("Example")).rejects.toThrow(/unreadable/);
        await expect(searchWebFidePlayers("12345")).rejects.toThrow(/different player/);
    });
    test("PC network stalls are bounded and cancellation reaches fetch", async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url, init) => {
                signal = init.signal;
                return new Promise(() => {});
            }),
        );
        const stalled = expect(searchWebFidePlayers("Example")).rejects.toThrow(/too long/);
        await vi.advanceTimersByTimeAsync(10_000);
        await stalled;
        expect(signal?.aborted).toBe(true);
        const caller = new AbortController();
        const cancelled = expect(
            searchWebFidePlayers("Example", caller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        caller.abort();
        await cancelled;
        expect(signal?.aborted).toBe(true);
    });
});

describe("shared desktop and phone import identity", () => {
    const signal = () => new AbortController().signal;
    test("a supplied ID must resolve, and conflicting supplied IDs never query or import", async () => {
        const search = vi.fn(async () => []);
        await expect(
            resolveFideImportIdentity("12345", "54321", null, search, signal()),
        ).rejects.toThrow(/differ/);
        expect(search).not.toHaveBeenCalled();
        await expect(
            resolveFideImportIdentity("12345", "", null, search, signal()),
        ).rejects.toThrow(/No player/);
    });
    test("a selected identity cannot silently combine a different name or ID", async () => {
        await expect(
            resolveFideImportIdentity(player.name, "54321", player, vi.fn(), signal()),
        ).rejects.toThrow(/no longer match/);
    });
    test("name-only imports retain manual coverage on service failure and never pick ambiguous names", async () => {
        const fail = vi.fn(async () => {
            throw Error("Offline");
        });
        expect(
            await resolveFideImportIdentity(player.name, "", null, fail, signal()),
        ).toMatchObject({ name: player.name, id: "", player: null });
        const duplicate = vi.fn(async () => [player, { ...player, id: 54321 }]);
        expect(
            (await resolveFideImportIdentity(player.name, "", null, duplicate, signal())).player,
        ).toBeNull();
    });
    test("numeric resolution carries its exact identity and birth year; late cancellation refuses a result", async () => {
        expect(
            await resolveFideImportIdentity("12345", "", null, async () => [player], signal()),
        ).toMatchObject({ name: player.name, id: "12345", player });
        const pending = deferred<(typeof player)[]>();
        const controller = new AbortController();
        const cancelled = expect(
            resolveFideImportIdentity("12345", "", null, () => pending.promise, controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        pending.resolve([player]);
        await cancelled;
    });
});
