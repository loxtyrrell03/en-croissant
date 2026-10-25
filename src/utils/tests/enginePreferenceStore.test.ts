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
