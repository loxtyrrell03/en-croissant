import { expect, it, vi } from "vitest";
import type { Engine } from "../engines";
import { createEnginePreferenceStore } from "../enginePreferenceStore";

const engine = (id: string): Engine => ({
    type: "local",
    id,
    name: id,
    version: "18",
    path: `C:/Fixture/${id}.exe`,
    loaded: false,
});
function fixture(initial: string | null) {
    let disk = initial;
    const io = {
        read: vi.fn(async () => disk),
        write: vi.fn(async (text: string) => {
            disk = text;
        }),
    };
    return {
        io,
        store: createEnginePreferenceStore(io),
        disk: () => disk,
        replace: (value: string) => {
            disk = value;
        },
    };
}
it("stages verified edits without exposing pending resource values to readers", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    const next = [{ ...previous[0], settings: [{ name: "Threads", value: 10 }] }];
    const edit = h.store.prepareVerifiedUpdate(next, () => true);
    expect(h.store.getSnapshot().value).toEqual(previous);
    expect(await h.store.storage.getItem("engines", [])).toEqual(previous);
    expect(h.io.write).not.toHaveBeenCalled();
    await edit.save();
    expect(h.store.isSavedValue(edit.value)).toBe(true);
    expect(h.io.write).toHaveBeenCalledTimes(1);
    await edit.save();
    expect(h.io.write).toHaveBeenCalledTimes(1);
});
it("keeps a verified failed edit separate, retries once and returns a disk receipt", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    h.io.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(edit.save()).rejects.toThrow("Disk unavailable");
    expect(h.store.getSnapshot().value).toEqual(previous);
    expect(await h.store.storage.getItem("engines", [])).toEqual(previous);
    await edit.save();
    expect(h.store.isSavedValue(edit.value)).toBe(true);
    expect(JSON.parse(h.disk()!)[0].name).toBe("Changed");
});
it("restores an unwritten failed edit without rewriting the exact original bytes", async () => {
    const original = JSON.stringify([engine("original")]);
    const h = fixture(original);
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    h.io.write.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(edit.save()).rejects.toThrow("Unavailable");
    await edit.restore();
    expect(h.io.write).toHaveBeenCalledTimes(1);
    expect(h.disk()).toBe(original);
    expect(h.store.isSavedValue(previous)).toBe(true);
});
it("restores only its own uncertain successful write, preserving exact previous bytes", async () => {
    const original = JSON.stringify([engine("original")]);
    const h = fixture(original);
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    h.io.write.mockImplementationOnce(async (text) => {
        h.replace(text);
        throw new Error("Lost receipt");
    });
    await expect(edit.save()).rejects.toThrow("Lost receipt");
    await edit.restore();
    expect(h.disk()).toBe(original);
    expect(h.store.getSnapshot().value).toEqual(previous);
    expect(h.store.getSnapshot().pending).toBe(false);
});
it("refuses to restore over another application's settings", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    h.io.write.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(edit.save()).rejects.toThrow("Unavailable");
    const external = JSON.stringify([engine("external")]);
    h.replace(external);
    await expect(edit.restore()).rejects.toThrow("another app");
    expect(h.disk()).toBe(external);
});
it("checks ownership after the asynchronous disk read and retains it on global retry", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    let owns = true;
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => owns);
    h.io.read.mockImplementationOnce(async () => {
        owns = false;
        return h.disk();
    });
    await expect(edit.save()).rejects.toThrow("changed during");
    expect(h.io.write).not.toHaveBeenCalled();
    await expect(h.store.retry()).rejects.toThrow("changed during");
    expect(h.io.write).not.toHaveBeenCalled();
});
it("does not retry or restore a superseded resource edit", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    h.io.write.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(edit.save()).rejects.toThrow("Unavailable");
    await h.store.storage.setItem("engines", [engine("newer")]);
    await expect(edit.save()).rejects.toThrow("newer");
    await expect(edit.restore()).rejects.toThrow("newer");
    expect(JSON.parse(h.disk()!)[0].id).toBe("newer");
});
it("coalesces queued local/shared retries after the first verified receipt changes ownership", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    let owns = true;
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => owns);
    h.io.write.mockImplementationOnce(async (text) => {
        h.replace(text);
        owns = false;
    });
    await Promise.all([edit.save(), h.store.retry()]);
    expect(h.io.write).toHaveBeenCalledTimes(1);
    expect(h.store.isSavedValue(edit.value)).toBe(true);
    expect(h.store.getSnapshot().error).toBeNull();
});
it("settles an unwritten canceled scope by readback and releases its pending snapshot", async () => {
    const original = JSON.stringify([engine("original")]);
    const h = fixture(original);
    const previous = await h.store.reload();
    let owns = true;
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => owns);
    owns = false;
    await expect(edit.save()).rejects.toThrow("replaced");
    expect(await edit.settleCanceled()).toEqual(previous);
    expect(h.store.isSavedValue(previous)).toBe(true);
    expect(h.io.write).not.toHaveBeenCalled();
});
it("settles only its exact uncertain written snapshot after scope cancellation without another write", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    let owns = true;
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => owns);
    h.io.write.mockImplementationOnce(async (text) => {
        h.replace(text);
        owns = false;
        throw new Error("Lost receipt");
    });
    await expect(edit.save()).rejects.toThrow("Lost receipt");
    const settled = await edit.settleCanceled();
    expect(settled).toEqual(edit.value);
    expect(h.store.isSavedValue(settled)).toBe(true);
    expect(h.io.write).toHaveBeenCalledTimes(1);
});
it("does not settle cancellation over external bytes", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    let owns = true;
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => owns);
    owns = false;
    const external = JSON.stringify([engine("external")]);
    h.replace(external);
    await expect(edit.settleCanceled()).rejects.toThrow("another app");
    expect(h.disk()).toBe(external);
    expect(h.io.write).not.toHaveBeenCalled();
});
it("does not discard a newer pending snapshot when a prior scope is canceled", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const previous = await h.store.reload();
    const edit = h.store.prepareVerifiedUpdate([{ ...previous[0], name: "Changed" }], () => true);
    const next = [engine("newer")];
    const save = h.store.storage.setItem("engines", next);
    const settle = edit.settleCanceled();
    await save;
    expect(await settle).toBeUndefined();
    expect(h.store.isSavedValue(next)).toBe(true);
    expect(JSON.parse(h.disk()!)[0].id).toBe("newer");
});
it.each(['{"broken":', '[{"type":"unknown","path":"keep-me"}]'])(
    "preserves unreadable settings without a normalization write: %s",
    async (text) => {
        const h = fixture(text);
        expect(await h.store.storage.getItem("engines", [])).toEqual([]);
        expect(h.store.getSnapshot().phase).toBe("error");
        await expect(h.store.storage.setItem("engines", [engine("new")])).rejects.toThrow(
            "preserved",
        );
        expect(h.disk()).toBe(text);
        expect(h.io.write).not.toHaveBeenCalled();
    },
);
it("distinguishes a missing store from an intentionally empty list, retaining extra fields without rewriting", async () => {
    const missing = fixture(null),
        empty = fixture("[]");
    await missing.store.storage.getItem("engines", []);
    await empty.store.storage.getItem("engines", []);
    expect(missing.store.getSnapshot().phase).toBe("missing");
    expect(empty.store.getSnapshot().phase).toBe("ready");
    const data = [
        { ...engine("custom"), futureOption: "keep", settings: [{ name: "Hash", value: 128 }] },
    ];
    const h = fixture(JSON.stringify(data));
    const loaded = await h.store.storage.getItem("engines", []);
    await h.store.storage.setItem("engines", loaded);
    expect(loaded[0]).toMatchObject({ futureOption: "keep" });
    expect(h.io.write).not.toHaveBeenCalled();
});
it("retains a failed immutable snapshot across reads and retries it with a verified receipt", async () => {
    const h = fixture("[]");
    await h.store.storage.getItem("engines", []);
    h.io.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    const value = [engine("retained")];
    const save = h.store.storage.setItem("engines", value);
    value[0].name = "Later mutation";
    await expect(save).rejects.toThrow("Disk unavailable");
    expect(h.disk()).toBe("[]");
    expect(h.store.getSnapshot().pending).toBe(true);
    expect((await h.store.storage.getItem("engines", []))[0].name).toBe("retained");
    await h.store.retry();
    await h.store.flush();
    expect(JSON.parse(h.disk()!)[0].name).toBe("retained");
    expect(h.store.getSnapshot().pending).toBe(false);
});
it("observes an uncertain successful write before retrying, without writing it twice", async () => {
    const h = fixture("[]");
    await h.store.storage.getItem("engines", []);
    h.io.write.mockImplementationOnce(async (text) => {
        h.replace(text);
        throw new Error("Receipt lost");
    });
    await expect(h.store.storage.setItem("engines", [engine("observed")])).rejects.toThrow(
        "Receipt lost",
    );
    await h.store.retry();
    await h.store.flush();
    expect(h.io.write).toHaveBeenCalledTimes(1);
    expect(h.store.getSnapshot().error).toBeNull();
});
it("rejects an external edit and retains the pending settings instead of overwriting the other app", async () => {
    const h = fixture("[]");
    await h.store.storage.getItem("engines", []);
    const external = JSON.stringify([engine("other-app")]);
    h.replace(external);
    await expect(h.store.storage.setItem("engines", [engine("pending")])).rejects.toThrow(
        "another app",
    );
    expect(h.disk()).toBe(external);
    expect(h.io.write).not.toHaveBeenCalled();
    expect((await h.store.storage.getItem("engines", []))[0].name).toBe("pending");
    await expect(h.store.flush()).rejects.toThrow("another app");
});
it("orders overlapping saves and persists an edit even when the UI mutated a loaded object", async () => {
    const h = fixture(JSON.stringify([engine("original")]));
    const loaded = await h.store.storage.getItem("engines", []);
    loaded[0].name = "Renamed";
    await h.store.storage.setItem("engines", [...loaded]);
    expect(JSON.parse(h.disk()!)[0].name).toBe("Renamed");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    h.io.write.mockImplementationOnce(async (text) => {
        await held;
        h.replace(text);
    });
    const first = h.store.storage.setItem("engines", [engine("first")]);
    const second = h.store.storage.setItem("engines", [engine("latest")]);
    release();
    await Promise.all([first, second]);
    await h.store.flush();
    expect(JSON.parse(h.disk()!)[0].id).toBe("latest");
});
