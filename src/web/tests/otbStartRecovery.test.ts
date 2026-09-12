import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebOtbImportRequest } from "../otbImport";

const key = "encroissant-web-otb-start",
    legacy = "encroissant-web-otb-job";
const request: WebOtbImportRequest = {
    playerName: "Example Player",
    fideId: "1503014",
    fromYear: 2024,
    sources: {
        lichessBroadcasts: true,
        broadcastArchives: true,
        communityBroadcasts: false,
        chessResults: true,
        chessbaseNews: true,
        officialPgnIndexes: true,
        twic: false,
    },
};
const id = "otb-00000000-0000-4000-8000-000000000001";
const saved = (accepted = false, jobId = id) => ({
    version: 1,
    id: jobId,
    server: "https://phone.example/api/otb-import/jobs",
    request,
    accepted,
});
const reply = (body: unknown, status = 202) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});
const job = (jobId: string) => ({ id: jobId, status: "running", request, games: [] });
const storage = new Map<string, string>();
let readFail = false,
    writeFail = "",
    ackFail = false;
let browser: EventTarget & {
    localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
    };
    location: { href: string };
};
const disposers: (() => void)[] = [];

beforeEach(() => {
    vi.resetModules();
    storage.clear();
    readFail = false;
    writeFail = "";
    ackFail = false;
    browser = Object.assign(new EventTarget(), {
        location: { href: "https://phone.example/" },
        localStorage: {
            getItem: (name: string) => {
                if (readFail) throw new Error("Fixture denied read");
                return storage.get(name) ?? null;
            },
            setItem: (name: string, value: string) => {
                if (writeFail === name || (ackFail && name === key && JSON.parse(value).accepted))
                    throw new Error("Fixture quota failure");
                storage.set(name, value);
            },
        },
    });
    vi.stubGlobal("window", browser);
    let locked = false;
    vi.stubGlobal("navigator", {
        locks: {
            request: async (
                _name: string,
                _options: unknown,
                action: (lock: object | null) => unknown,
            ) => {
                if (locked) return action(null);
                locked = true;
                try {
                    return action({});
                } finally {
                    locked = false;
                }
            },
        },
    });
    let sequence = 0;
    vi.stubGlobal("crypto", {
        randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => reply(job(String(url).split("/").at(-1)!))),
    );
});
afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
async function session() {
    const next = await import("../otbStartSession");
    disposers.push(next.subscribeWebOtbStart(() => {}));
    return next;
}
function changed() {
    browser.dispatchEvent(Object.assign(new Event("storage"), { key }));
}

describe("durable phone OTB starts", () => {
    it("keeps a large artifact download alive beyond the small-status deadline", async () => {
        vi.useFakeTimers();
        let finish!: (value: unknown) => void;
        const body = new Promise((resolve) => {
            finish = resolve;
        });
        let artifactSignal!: AbortSignal;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init: RequestInit) => {
                if (String(url).endsWith("/artifact")) {
                    artifactSignal = init.signal!;
                    return { ok: true, status: 200, json: () => body };
                }
                return reply({
                    ...job(id),
                    status: "completed",
                    artifactAvailable: true,
                    games: undefined,
                });
            }),
        );
        const { loadWebOtbImportJob } = await import("../otbImport");
        const pending = loadWebOtbImportJob(id);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(artifactSignal.aborted).toBe(false);
        finish({ jobId: id, games: [], prepDatabase: null });
        await expect(pending).resolves.toMatchObject({ id, artifactLoaded: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds a stalled artifact body separately and preserves its PC identity", async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) =>
                String(url).endsWith("/artifact")
                    ? { ok: true, status: 200, json: () => new Promise(() => {}) }
                    : reply({
                          ...job(id),
                          status: "completed",
                          artifactAvailable: true,
                          games: undefined,
                      }),
            ),
        );
        const { loadWebOtbImportJob } = await import("../otbImport");
        const pending = loadWebOtbImportJob(id).then(
            () => null,
            (error) => error,
        );
        await vi.advanceTimersByTimeAsync(600_001);
        expect(await pending).toMatchObject({
            message: expect.stringContaining("could not finish downloading"),
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("caller cancellation promptly releases a stalled status request", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => new Promise(() => {})),
        );
        const { loadWebOtbImportJob } = await import("../otbImport");
        const pending = loadWebOtbImportJob(id, controller.signal);
        controller.abort(new Error("Left the view"));
        await expect(pending).rejects.toThrow("Left the view");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("saves the full request before sending and owns it beyond view unmount", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            const record = JSON.parse(storage.get(key)!);
            expect(record).toMatchObject({ id, accepted: false, request });
            expect(init.method).toBe("PUT");
            expect(JSON.parse(String(init.body))).toEqual(request);
            await gate;
            return reply(job(String(url).split("/").at(-1)!));
        });
        vi.stubGlobal("fetch", fetchMock);
        const s = await session();
        const first = s.beginWebOtbStart(request, null),
            second = s.beginWebOtbStart(request, null);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        disposers.splice(0).forEach((dispose) => dispose());
        expect(s.getWebOtbStartSnapshot().busy).toBe(true);
        release();
        await Promise.all([first, second]);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved(true));
        expect(storage.get(legacy)).toBe(id);
        expect(s.getWebOtbStartSnapshot()).toMatchObject({ busy: false, jobId: id, error: null });
    });

    it("reconnects a lost reply with the identical ID and original request after reload", async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("Fixture reply lost"))
            .mockResolvedValue(reply(job(id)));
        vi.stubGlobal("fetch", fetchMock);
        const first = await session();
        await first.beginWebOtbStart(request, null);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved());
        expect(first.getWebOtbStartSnapshot().error).toContain("reply lost");
        vi.resetModules();
        const reloaded = await session();
        expect(reloaded.getWebOtbStartSnapshot()).toMatchObject({ jobId: null, record: saved() });
        await reloaded.retryWebOtbStart();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]![0]).toBe(fetchMock.mock.calls[0]![0]);
        expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved(true));
    });

    it("does not contact the PC when the initial durable write fails", async () => {
        storage.set(legacy, "old-result");
        writeFail = key;
        const s = await session();
        await s.beginWebOtbStart(request, "old-result");
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.get(legacy)).toBe("old-result");
        expect(storage.has(key)).toBe(false);
        expect(s.getWebOtbStartSnapshot().error).toContain("browser");
        writeFail = "";
        await s.retryWebOtbStart();
        expect(fetch).not.toHaveBeenCalled();
        await s.beginWebOtbStart(request, "old-result");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("preserves unreadable storage and lets the user retry reading it", async () => {
        storage.set(legacy, "old-result");
        readFail = true;
        const s = await session();
        expect(s.getWebOtbStartSnapshot().ready).toBe(false);
        await s.beginWebOtbStart(request, null);
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.get(legacy)).toBe("old-result");
        readFail = false;
        await s.retryWebOtbStart();
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            ready: true,
            jobId: "old-result",
            error: null,
        });
    });

    it("retries a failed acknowledgement save without another network start", async () => {
        ackFail = true;
        const s = await session();
        await s.beginWebOtbStart(request, null);
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            jobId: id,
            confirmed: { id },
            record: { accepted: false },
        });
        expect(JSON.parse(storage.get(key)!)).toEqual(saved());
        ackFail = false;
        await s.retryWebOtbStart();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved(true));
    });

    it("recovers a failed acknowledgement through PUT after a complete reload", async () => {
        ackFail = true;
        const s = await session();
        await s.beginWebOtbStart(request, null);
        ackFail = false;
        vi.resetModules();
        const reloaded = await session();
        await reloaded.retryWebOtbStart();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved(true));
    });

    it("keeps the complete acknowledged record authoritative if the legacy mirror fails", async () => {
        writeFail = legacy;
        const s = await session();
        await s.beginWebOtbStart(request, null);
        expect(s.getWebOtbStartSnapshot()).toMatchObject({ jobId: id, error: null });
        vi.resetModules();
        const reloaded = await session();
        expect(reloaded.getWebOtbStartSnapshot().jobId).toBe(id);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("rejects an obsolete reply after another tab selects a different search", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                await gate;
                return reply(job(id));
            }),
        );
        const s = await session(),
            start = s.beginWebOtbStart(request, null);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const newerId = id.replace(/1$/, "2"),
            newer = saved(true, newerId);
        storage.set(key, JSON.stringify(newer));
        storage.set(legacy, newerId);
        changed();
        release();
        await start;
        expect(JSON.parse(storage.get(key)!)).toEqual(newer);
        expect(storage.get(legacy)).toBe(newerId);
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            jobId: newerId,
            confirmed: null,
            error: null,
        });
    });

    it("two sessions cannot replace each other's pending request", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                await gate;
                return reply(job(id));
            }),
        );
        const first = await session();
        vi.resetModules();
        const second = await session();
        const start = first.beginWebOtbStart(request, null);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        await second.beginWebOtbStart({ ...request, playerName: "Another Player" }, null);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.get(key)!)).toEqual(saved());
        release();
        await start;
    });

    it.each([
        "null",
        "{",
        JSON.stringify({ ...saved(), request: { ...request, sources: {} } }),
        JSON.stringify({ ...saved(), server: "https://other.example/api/otb-import/jobs" }),
    ])(
        "retains corrupt or different-server records instead of overwriting them: %s",
        async (original) => {
            storage.set(key, original);
            const s = await session();
            expect(s.getWebOtbStartSnapshot().ready).toBe(false);
            await s.beginWebOtbStart(request, null);
            await s.retryWebOtbStart();
            expect(fetch).not.toHaveBeenCalled();
            expect(storage.get(key)).toBe(original);
        },
    );

    it("shows an older-service error and never falls back to POST", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(reply({ error: "Method not allowed" }, 405))
            .mockResolvedValue(reply(job(id)));
        vi.stubGlobal("fetch", fetchMock);
        const s = await session();
        await s.beginWebOtbStart(request, null);
        expect(s.getWebOtbStartSnapshot().error).toContain("needs updating");
        expect(JSON.parse(storage.get(key)!)).toEqual(saved());
        await s.retryWebOtbStart();
        expect(fetchMock.mock.calls.every((call) => call[1].method === "PUT")).toBe(true);
        expect(new Set(fetchMock.mock.calls.map((call) => call[0])).size).toBe(1);
    });

    it("does not acknowledge a response containing another request", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(reply({ ...job(id), request: { ...request, fromYear: 2023 } })),
        );
        const s = await session();
        await s.beginWebOtbStart(request, null);
        expect(s.getWebOtbStartSnapshot().error).toContain("different search");
        expect(JSON.parse(storage.get(key)!)).toEqual(saved());
    });

    it.each(["headers", "body"])(
        "bounds a stalled start %s and retains its retry identity",
        async (phase) => {
            vi.useFakeTimers();
            const never = new Promise<never>(() => {});
            vi.stubGlobal(
                "fetch",
                vi
                    .fn()
                    .mockImplementation(() =>
                        phase === "headers" ? never : { ok: true, json: () => never },
                    ),
            );
            const s = await session(),
                start = s.beginWebOtbStart(request, null);
            await vi.advanceTimersByTimeAsync(15_001);
            await start;
            expect(s.getWebOtbStartSnapshot()).toMatchObject({
                busy: false,
                error: expect.stringContaining("too long"),
                record: { id, accepted: false },
            });
        },
    );

    it("fails visibly before mutation when cross-tab coordination is unavailable", async () => {
        vi.stubGlobal("navigator", {});
        const s = await session();
        await s.beginWebOtbStart(request, null);
        expect(s.getWebOtbStartSnapshot().error).toContain("secure phone app");
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.size).toBe(0);
    });
});
