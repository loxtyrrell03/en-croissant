import { beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_OTB_IMPORT_SOURCES } from "../otbImportModel";
import type { OpponentCollection } from "../platform";
import type { WebOtbImportJob } from "@/web/otbImport";
const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    start: vi.fn(),
    watch: vi.fn(),
    refresh: vi.fn(),
    save: vi.fn(),
    cancel: vi.fn(),
}));
vi.mock("../platform", () => ({
    isNativeDesktop: () => false,
    desktopApi: {
        collectionCreate: mocks.create,
        collectionGet: mocks.get,
        collectionUpdate: mocks.update,
        cancelOtbGames: mocks.cancel,
    },
}));
vi.mock("@/web/otbImport", () => ({
    startWebOtbImport: mocks.start,
    watchWebOtbImportJob: mocks.watch,
    refreshWebOtbImportJob: mocks.refresh,
}));
vi.mock("../phoneTournament", () => ({ savePhoneTournamentImport: mocks.save }));
import { importOpponent, importView, restoreOpponentImport } from "../opponentImport";
let collection: OpponentCollection, job: WebOtbImportJob;
const options = () => ({
    playerName: "Alex Example",
    fideId: "12345",
    fromYear: 2020,
    requestKey: crypto.randomUUID(),
    sources: DEFAULT_OTB_IMPORT_SOURCES,
    refresh: true,
});
beforeEach(() => {
    vi.clearAllMocks();
    collection = {
        id: 7,
        name: "Alex Example",
        folder: null,
        game_count: 0,
        metadata: {},
    };
    mocks.create.mockResolvedValue(7);
    mocks.get.mockImplementation(async () => structuredClone(collection));
    mocks.update.mockImplementation(async (_id, count, metadata) => {
        collection = { ...collection, game_count: count, metadata: structuredClone(metadata) };
    });
    mocks.start.mockImplementation(async (request, id) => {
        job = {
            id,
            request,
            status: "completed",
            prepDatabase: { games: [{}] },
            report: { cancelled: false },
            progress: null,
        } as WebOtbImportJob;
    });
    mocks.watch.mockImplementation((_id, onJob) => {
        queueMicrotask(() => onJob(job));
        return () => {};
    });
    mocks.save.mockResolvedValue({
        phoneDatabaseId: "tournament-opponent-7",
        phonePrepId: "prep-tournament-opponent-7",
        gameCount: 1,
    });
});
test("concurrent clicks share the same request and only one import", async () => {
    const request = options();
    const a = importOpponent(request),
        b = importOpponent(request);
    expect(a).toBe(b);
    expect((await a).gameCount).toBe(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(collection.metadata.phase).toBe("ready");
});
test("a failed save resumes the same downloaded job without collecting again", async () => {
    const request = options();
    mocks.save.mockRejectedValueOnce(new Error("Storage full"));
    await expect(importOpponent(request)).rejects.toThrow("Storage full");
    expect(collection.metadata.phase).toBe("save");
    const id = collection.metadata.jobId;
    await importOpponent(request);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(collection.metadata.savedJobIds).toEqual([id]);
});
test("rejects a different FIDE identity before accessing a downloaded job", async () => {
    const request = options();
    await importOpponent(request);
    await expect(importOpponent({ ...request, fideId: "99999" })).rejects.toThrow("different FIDE");
    expect(mocks.start).toHaveBeenCalledTimes(1);
});
test("a completed checkpoint restores Open Prep without new source traffic", async () => {
    const request = options();
    await importOpponent(request);
    restoreOpponentImport("restored", collection);
    expect(importView("restored").result?.gameCount).toBe(1);
    expect((await importOpponent({ ...request, refresh: false })).gameCount).toBe(1);
    expect(mocks.start).toHaveBeenCalledTimes(1);
});
test("rejects mismatched job identity while resuming a save", async () => {
    const request = options();
    mocks.save.mockRejectedValueOnce(new Error("Storage full"));
    await expect(importOpponent(request)).rejects.toThrow();
    job.request = { ...job.request, fideId: "99999" };
    await expect(importOpponent(request)).rejects.toThrow("does not match");
    expect(mocks.save).toHaveBeenCalledTimes(1);
});
