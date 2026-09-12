// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const key = "encroissant-web-otb-start",
    legacy = "encroissant-web-otb-job",
    id = "otb-00000000-0000-4000-8000-000000000001";
const request = {
    playerName: "Example Player",
    fideId: "1503014",
    fromYear: 2024,
    sources: {
        lichessBroadcasts: true,
        broadcastArchives: true,
        communityBroadcasts: true,
        chessResults: true,
        chessbaseNews: true,
        officialPgnIndexes: true,
        twic: true,
    },
};
const stored = (server = "https://phone.example/api/otb-import/jobs") =>
    JSON.stringify({ version: 1, id, server, request, accepted: true });
const missing = () => Response.json({ error: "OTB import job not found." }, { status: 404 });
const status = (jobId = id) => ({
    id: jobId,
    status: "running",
    request,
    gameCount: 0,
    artifactAvailable: false,
});
let storage: Map<string, string>, readFail: boolean, writeFail: boolean, removeFail: boolean;
const disposers: Array<() => void> = [];
beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    readFail = false;
    writeFail = false;
    removeFail = false;
    vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
            location: { href: "https://phone.example/" },
            localStorage: {
                getItem: (name: string) => {
                    if (readFail) throw Error("Example read denied");
                    return storage.get(name) ?? null;
                },
                setItem: (name: string, value: string) => {
                    if (writeFail) throw Error("Example full browser storage");
                    storage.set(name, value);
                },
                removeItem: (name: string) => {
                    if (removeFail) throw Error("Example remove denied");
                    storage.delete(name);
                },
            },
        }),
    );
    vi.stubGlobal("navigator", {
        locks: {
            request: async (_name: string, _options: unknown, action: (lock: object) => unknown) =>
                action({}),
        },
    });
    let sequence = 2;
    vi.stubGlobal("crypto", {
        randomUUID: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => missing()),
    );
});
afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
async function session() {
    const s = await import("../otbStartSession");
    disposers.push(s.subscribeWebOtbStart(() => {}));
    return s;
}

describe("reviewed phone search recovery", () => {
    it.each([
        "{broken",
        JSON.stringify({ version: 9 }),
        JSON.stringify({ version: 1, state: "idle" }),
        JSON.stringify({ ...JSON.parse(stored()), state: "idle" }),
        stored("https://other-pc.example/api/otb-import/jobs"),
    ])("preserves unreadable or other-PC tracking exactly and can undo %s", async (raw) => {
        storage.set(key, raw);
        storage.set(legacy, "old-legacy-job");
        const s = await session();
        expect(s.getWebOtbStartSnapshot()).toMatchObject({ ready: false, canSetAside: true });
        const review = s.reviewWebOtbSelection(null);
        await s.setAsideWebOtbSelection(review);
        const saved = JSON.parse(storage.get(key)!);
        expect(saved).toMatchObject({
            version: 1,
            state: "idle",
            previousSearches: [{ startRaw: raw, legacyRaw: "old-legacy-job" }],
        });
        expect(storage.get(legacy)).toBe("old-legacy-job");
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            ready: true,
            jobId: null,
            record: null,
        });
        expect(fetch).not.toHaveBeenCalled();
        await s.undoWebOtbSetAside(saved.previousSearches[0].id);
        expect(storage.get(key)).toBe(raw);
        expect(storage.get(legacy)).toBe("old-legacy-job");
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            ready: false,
            canSetAside: true,
            previousSearches: [],
        });
    });
    it("retains legacy tracking through set aside, reload and undo", async () => {
        storage.set(legacy, id);
        let s = await session();
        const review = s.reviewWebOtbSelection(id);
        await s.setAsideWebOtbSelection(review);
        const details = s.getWebOtbStartSnapshot().previousSearches[0];
        expect(details.startRaw).toBeNull();
        vi.resetModules();
        s = await session();
        expect(s.getWebOtbStartSnapshot().jobId).toBeNull();
        await s.undoWebOtbSetAside(details.id);
        expect(storage.has(key)).toBe(false);
        expect(s.getWebOtbStartSnapshot().jobId).toBe(id);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBeUndefined();
    });
    it("cannot lose the old selection when saving its copy fails", async () => {
        const raw = stored();
        storage.set(key, raw);
        storage.set(legacy, id);
        const s = await session();
        const review = s.reviewWebOtbSelection(id);
        writeFail = true;
        await s.setAsideWebOtbSelection(review);
        expect(storage.get(key)).toBe(raw);
        expect(storage.get(legacy)).toBe(id);
        expect(s.getWebOtbStartSnapshot()).toMatchObject({
            jobId: id,
            errorAction: "set-aside",
            previousSearches: [],
        });
        writeFail = false;
        await s.setAsideWebOtbSelection(review);
        expect(s.getWebOtbStartSnapshot().previousSearches).toHaveLength(1);
    });
    it("refuses recovery when it cannot read an exact copy of both keys", async () => {
        storage.set(key, stored());
        const s = await session();
        readFail = true;
        expect(() => s.reviewWebOtbSelection(id)).toThrow("read denied");
        expect(storage.get(key)).toBe(stored());
        expect(fetch).not.toHaveBeenCalled();
    });
    it("a job that reappears during review is not set aside", async () => {
        storage.set(key, stored());
        const s = await session();
        const review = s.reviewWebOtbSelection(id);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json(status())),
        );
        await s.setAsideWebOtbSelection(review);
        expect(storage.get(key)).toBe(stored());
        expect(s.getWebOtbStartSnapshot().previousSearches).toEqual([]);
    });
    it.each([
        () => Response.json({ error: "Generic proxy 404" }, { status: 404 }),
        () => Promise.reject(Error("Example offline")),
    ])("an uncertain recheck preserves the selection", async (response) => {
        storage.set(key, stored());
        const s = await session();
        const review = s.reviewWebOtbSelection(id);
        vi.stubGlobal("fetch", vi.fn(response));
        await s.setAsideWebOtbSelection(review);
        expect(storage.get(key)).toBe(stored());
        expect(s.getWebOtbStartSnapshot().error).toBeTruthy();
    });
    it("a new selection during the missing-job recheck cannot be overwritten", async () => {
        storage.set(key, stored());
        const s = await session();
        const review = s.reviewWebOtbSelection(id);
        let resolve!: (reply: Response) => void;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>((yes) => {
                        resolve = yes;
                    }),
            ),
        );
        const pending = s.setAsideWebOtbSelection(review);
        await Promise.resolve();
        const newer = stored().replaceAll(id, "otb-00000000-0000-4000-8000-000000000099");
        storage.set(key, newer);
        resolve(missing());
        await pending;
        expect(storage.get(key)).toBe(newer);
        expect(s.getWebOtbStartSnapshot().error).toContain("changed in another tab");
    });
    it("duplicate confirmation owns one request and one stored copy", async () => {
        storage.set(key, stored());
        const s = await session();
        const review = s.reviewWebOtbSelection(id);
        const first = s.setAsideWebOtbSelection(review);
        expect(s.setAsideWebOtbSelection(review)).toBe(first);
        await first;
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(s.getWebOtbStartSnapshot().previousSearches).toHaveLength(1);
    });
    it("a new search keeps previous details and makes undo refuse the newer selection", async () => {
        storage.set(key, stored());
        const s = await session();
        await s.setAsideWebOtbSelection(s.reviewWebOtbSelection(id));
        const details = s.getWebOtbStartSnapshot().previousSearches[0];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url) => Response.json(status(String(url).split("/").at(-1)!))),
        );
        await s.beginWebOtbStart(request, null);
        const newer = storage.get(key);
        expect(JSON.parse(newer!).previousSearches).toEqual([details]);
        await s.undoWebOtbSetAside(details.id);
        expect(storage.get(key)).toBe(newer);
        expect(s.getWebOtbStartSnapshot().error).toContain("selected search changed");
    });
    it("does not revive an old preflight after recovery returns the selection to idle", async () => {
        const s = await session();
        const version = s.getWebOtbSelectionVersion();
        storage.set(key, "{broken example");
        await s.setAsideWebOtbSelection(s.reviewWebOtbSelection(null));
        const recovered = storage.get(key);
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url) => Response.json(status(String(url).split("/").at(-1)!))),
        );
        await s.beginWebOtbStart(request, null, version);
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.get(key)).toBe(recovered);
        expect(s.getWebOtbStartSnapshot().error).toContain("changed while finding the player");
    });

    it("failed undo retains the saved copy and retries without touching the PC", async () => {
        storage.set(legacy, id);
        const s = await session();
        await s.setAsideWebOtbSelection(s.reviewWebOtbSelection(id));
        const saved = storage.get(key),
            details = s.getWebOtbStartSnapshot().previousSearches[0];
        removeFail = true;
        await s.undoWebOtbSetAside(details.id);
        expect(storage.get(key)).toBe(saved);
        expect(s.getWebOtbStartSnapshot().errorAction).toBe("undo");
        removeFail = false;
        await s.undoWebOtbSetAside(details.id);
        expect(s.getWebOtbStartSnapshot().jobId).toBe(id);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe("missing job observations", () => {
    it("stops polling an authoritative missing job, replays its error, and supports an explicit retry", async () => {
        vi.useFakeTimers();
        const api = await import("../otbImport");
        const error = vi.fn(),
            job = vi.fn();
        const unsubscribe = api.watchWebOtbImportJob(id, job, error);
        disposers.push(unsubscribe);
        await vi.advanceTimersByTimeAsync(0);
        expect(error.mock.calls[0][0]).toBeInstanceOf(api.WebOtbJobNotFoundError);
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetch).toHaveBeenCalledTimes(1);
        unsubscribe();
        const replay = vi.fn();
        disposers.push(api.watchWebOtbImportJob(id, job, replay));
        expect(replay.mock.calls[0][0]).toBeInstanceOf(api.WebOtbJobNotFoundError);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json(status())),
        );
        api.refreshWebOtbImportJob(id);
        await vi.advanceTimersByTimeAsync(0);
        expect(job).toHaveBeenLastCalledWith(expect.objectContaining({ id, status: "running" }));
    });
    it("a generic 404 is not proof of a missing saved job", async () => {
        const api = await import("../otbImport");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ error: "Proxy route unavailable" }, { status: 404 })),
        );
        const error = await api.loadWebOtbImportJobStatus(id).catch((error) => error);
        expect(error).not.toBeInstanceOf(api.WebOtbJobNotFoundError);
    });
});
