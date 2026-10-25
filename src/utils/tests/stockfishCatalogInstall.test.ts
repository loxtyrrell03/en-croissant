import { expect, it, vi } from "vitest";
import type { Engine } from "../engines";
import { createEnginePreferenceStore } from "../enginePreferenceStore";
import { createStockfishCatalogInstall } from "../stockfishCatalogInstall";

const older: Engine = {
    type: "local",
    id: "owner",
    name: "Owner default",
    version: "18",
    path: "C:/Owner/old.exe",
    loaded: false,
    settings: [{ name: "Hash", value: 128 }],
};
const installed = { path: "C:/Fixture/19/stockfish.exe", version: "19" };
const deferred = <T>() => {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
async function fixture(profiles: Engine[] = [older]) {
    let disk = JSON.stringify(profiles),
        model: Engine[] | undefined;
    let directory = "C:/Fixture/Engines",
        loaded = directory;
    const write = vi.fn(async (text: string) => {
        disk = text;
    });
    const preferences = createEnginePreferenceStore({
        beginLoad: async () => {
            loaded = directory;
        },
        identity: () => loaded,
        read: async () => disk,
        write,
    });
    model = await preferences.reload();
    const io = {
        directory: vi.fn(async () => directory),
        loadedDirectory: preferences.getLoadedContext,
        saved: preferences.isSavedValue,
        available: vi.fn(async () => installed as typeof installed | null),
        install: vi.fn(async () => installed),
        cancel: vi.fn(async () => true),
        flush: preferences.flush,
        retrySave: vi.fn(preferences.retry),
    };
    const context = {
        read: () => model,
        write(next: Engine[]) {
            preferences.noteModelUpdate(next);
            model = next;
            void Promise.resolve(preferences.storage.setItem("engines", next)).catch(() => {});
        },
    };
    return {
        io,
        context,
        write,
        preferences,
        operation: createStockfishCatalogInstall(io),
        disk: () => JSON.parse(disk),
        moveFolder: (next: string) => {
            directory = next;
        },
    };
}

it("uses verified included files, appends a disabled profile and preserves default/tuning/order", async () => {
    const h = await fixture();
    await h.operation.add(h.context);
    expect(h.io.install).not.toHaveBeenCalled();
    expect(h.disk()).toEqual([older, expect.objectContaining({ version: "19", enabled: false })]);
    expect(h.operation.getSnapshot()).toMatchObject({ phase: "complete", pendingSave: false });
});
it("retains a differently located managed ID and an existing same-path custom/newer profile", async () => {
    const h = await fixture([{ ...older, id: "managed-stockfish-19" }]);
    await h.operation.add(h.context);
    expect(h.disk()[0]).toMatchObject({ id: "managed-stockfish-19", path: older.path });
    expect(h.disk()[1].id).not.toBe("managed-stockfish-19");
    const custom: Engine = {
        ...older,
        id: "custom",
        version: "20",
        path: installed.path.toUpperCase().replaceAll("/", "\\"),
    };
    const existing = await fixture([older, custom]);
    await existing.operation.add(existing.context);
    expect(existing.disk()).toEqual([older, custom]);
    expect(existing.write).not.toHaveBeenCalled();
});
it("waits for the saved profile, not just completed downloads, and cannot cancel a committed model change", async () => {
    const h = await fixture();
    h.io.available.mockResolvedValue(null);
    const save = deferred<void>();
    const write = h.write.getMockImplementation()!;
    h.write.mockImplementationOnce(async (text) => {
        await save.promise;
        await write(text);
    });
    const adding = h.operation.add(h.context);
    await vi.waitFor(() => expect(h.operation.getSnapshot().phase).toBe("saving"));
    await h.operation.cancel();
    expect(h.io.cancel).not.toHaveBeenCalled();
    expect(h.operation.getSnapshot().pendingSave).toBe(true);
    save.resolve();
    await adding;
    expect(h.operation.getSnapshot()).toMatchObject({ phase: "complete", pendingSave: false });
});
it("keeps failed settings for a durable retry without reinstalling or reapplying a later owner choice", async () => {
    const h = await fixture();
    h.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    await h.operation.add(h.context);
    expect(h.operation.getSnapshot()).toMatchObject({ phase: "error", pendingSave: true });
    expect(h.disk()).toEqual([older]);
    const newer = h.context.read()!.map((profile) => ({ ...profile, name: "Later owner name" }));
    h.context.write(newer);
    await h.preferences.flush();
    await h.operation.retrySave(h.context);
    expect(h.disk()).toEqual(newer);
    expect(h.operation.getSnapshot().phase).toBe("complete");
    expect(h.io.available).toHaveBeenCalledTimes(1);
    expect(h.io.install).not.toHaveBeenCalled();
});
it("does not re-add an engine removed after a failed save", async () => {
    const h = await fixture();
    h.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    await h.operation.add(h.context);
    h.context.write([older]);
    await h.preferences.flush();
    await h.operation.retrySave(h.context);
    expect(h.disk()).toEqual([older]);
    expect(h.operation.getSnapshot()).toMatchObject({ phase: "idle", pendingSave: false });
});
it("holds cancelled lookup ownership until its late reply settles, without adding or downloading", async () => {
    const h = await fixture(),
        lookup = deferred<typeof installed>();
    h.io.available.mockReturnValueOnce(lookup.promise);
    const adding = h.operation.add(h.context);
    await vi.waitFor(() => expect(h.io.available).toHaveBeenCalled());
    await h.operation.cancel();
    await h.operation.add(h.context);
    expect(h.operation.getSnapshot().phase).toBe("cancelling");
    expect(h.io.available).toHaveBeenCalledTimes(1);
    lookup.resolve(installed);
    await adding;
    expect(h.operation.getSnapshot().phase).toBe("cancelled");
    expect(h.disk()).toEqual([older]);
    expect(h.io.install).not.toHaveBeenCalled();
});
it.each(["resolve", "reject"] as const)(
    "cancels the exact native request and keeps ownership through native %s",
    async (result) => {
        const h = await fixture(),
            download = deferred<typeof installed>();
        h.io.available.mockResolvedValue(null);
        h.io.install.mockReturnValueOnce(download.promise);
        const adding = h.operation.add(h.context);
        await vi.waitFor(() => expect(h.io.install).toHaveBeenCalled());
        const id = h.operation.getSnapshot().id;
        await h.operation.cancel();
        await h.operation.add(h.context);
        expect(h.io.cancel).toHaveBeenCalledWith(id);
        expect(h.operation.getSnapshot().phase).toBe("cancelling");
        expect(h.io.install).toHaveBeenCalledTimes(1);
        if (result === "resolve") download.resolve(installed);
        else download.reject(new Error("Native cancellation"));
        await adding;
        expect(h.operation.getSnapshot().phase).toBe("cancelled");
        expect(h.disk()).toEqual([older]);
    },
);
it("keeps a failed cancel request visibly busy and retryable until native work really stops", async () => {
    const h = await fixture(),
        download = deferred<typeof installed>();
    h.io.available.mockResolvedValue(null);
    h.io.install.mockReturnValueOnce(download.promise);
    h.io.cancel.mockRejectedValueOnce(new Error("IPC temporarily unavailable"));
    const adding = h.operation.add(h.context);
    await vi.waitFor(() => expect(h.io.install).toHaveBeenCalled());
    await h.operation.cancel();
    expect(h.operation.getSnapshot()).toMatchObject({
        phase: "cancelling",
        error: expect.stringContaining("Retry Cancel"),
    });
    await h.operation.cancel();
    expect(h.io.cancel).toHaveBeenCalledTimes(2);
    download.resolve(installed);
    await adding;
    expect(h.operation.getSnapshot().phase).toBe("cancelled");
    expect(h.disk()).toEqual([older]);
});
it("appends to the latest saved owner list after downloading, instead of replacing a captured list", async () => {
    const h = await fixture(),
        download = deferred<typeof installed>();
    h.io.available.mockResolvedValue(null);
    h.io.install.mockReturnValueOnce(download.promise);
    const adding = h.operation.add(h.context);
    await vi.waitFor(() => expect(h.io.install).toHaveBeenCalled());
    const changed: Engine = { ...older, name: "Edited while downloading" };
    h.context.write([changed]);
    await h.preferences.flush();
    download.resolve(installed);
    await adding;
    expect(h.disk()).toEqual([changed, expect.objectContaining({ version: "19" })]);
});
it("preserves profiles when the selected engine folder changes during download", async () => {
    const h = await fixture(),
        download = deferred<typeof installed>();
    h.io.available.mockResolvedValue(null);
    h.io.install.mockReturnValueOnce(download.promise);
    const adding = h.operation.add(h.context);
    await vi.waitFor(() => expect(h.io.install).toHaveBeenCalled());
    h.moveFolder("C:/OtherFolder");
    download.resolve(installed);
    await adding;
    expect(h.operation.getSnapshot()).toMatchObject({
        phase: "error",
        error: expect.stringContaining("folder changed"),
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.disk()).toEqual([older]);
});
it("does not install or add over unresolved pending settings", async () => {
    const h = await fixture();
    h.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    h.context.write([{ ...older, name: "Pending owner choice" }]);
    await h.preferences.flush().catch(() => {});
    await h.operation.add(h.context);
    expect(h.operation.getSnapshot().phase).toBe("error");
    expect(h.io.available).not.toHaveBeenCalled();
    expect(h.io.install).not.toHaveBeenCalled();
});
it("rejects unexpected native versions without treating download completion as profile success", async () => {
    const h = await fixture();
    h.io.available.mockResolvedValue({ ...installed, version: "18" });
    await h.operation.add(h.context);
    expect(h.operation.getSnapshot()).toMatchObject({ phase: "error", pendingSave: false });
    expect(h.disk()).toEqual([older]);
});
