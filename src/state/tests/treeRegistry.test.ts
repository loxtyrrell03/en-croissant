import { afterEach, describe, expect, it, vi } from "vitest";
import { createTreeStore } from "../store/tree";
import { getTabTreeStore, releaseTabTreeStore } from "../store/treeRegistry";
import {
    readDebouncedSessionStorageItem,
    removeDebouncedSessionStorageItem,
} from "../store/debouncedStorage";
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
const ids = ["registry-owned", "registry-rehydrate", "registry-bad"];
afterEach(() => {
    for (const id of ids) {
        releaseTabTreeStore(id);
        removeDebouncedSessionStorageItem(id);
    }
});

describe("canonical tab tree ownership", () => {
    it("returns the live tree before delayed session storage has caught up", () => {
        const tree = getTabTreeStore("registry-owned");
        tree.getState().setComment("Latest unsaved note");
        expect(sessionStorage.getItem("registry-owned")).toBeNull();
        expect(getTabTreeStore("registry-owned")).toBe(tree);
        expect(
            readDebouncedSessionStorageItem<{ root: { comment: string } }>("registry-owned")?.state
                .root.comment,
        ).toBe("Latest unsaved note");
    });
    it("rehydrates pending data without copying old stores' action closures", () => {
        const old = createTreeStore("registry-rehydrate");
        old.getState().setComment("Old store");
        const current = getTabTreeStore("registry-rehydrate");
        expect(current.getState().root.comment).toBe("Old store");
        current.getState().setComment("New store");
        expect(current.getState().root.comment).toBe("New store");
        expect(old.getState().root.comment).toBe("Old store");
        expect(current.getState().dirty).toBe(true);
    });
    it("fails closed on malformed saved tab state", () => {
        sessionStorage.setItem("registry-bad", '{"version":0,"state":{"dirty":true}}');
        expect(() => getTabTreeStore("registry-bad")).toThrow("kept open");
        expect(sessionStorage.getItem("registry-bad")).toContain('"dirty":true');
    });
});
