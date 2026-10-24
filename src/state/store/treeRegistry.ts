import { createTreeStore, type TreeStore } from "./tree";
import type { TreeState } from "@/utils/treeReducer";
import { readDebouncedSessionStorageItem } from "./debouncedStorage";
import { ownTabTree } from "./treeOwner";

const stores = new Map<string, TreeStore>();

/** One live tree per tab, shared by its board, saves and close controller. */
export function getTabTreeStore(id: string, initial?: TreeState): TreeStore {
    let store = stores.get(id);
    if (!store) {
        const saved = readDebouncedSessionStorageItem<TreeState>(id);
        if (
            saved &&
            ((saved.version !== undefined && saved.version !== 0) ||
                !saved.state?.root ||
                typeof saved.state.root.fen !== "string" ||
                !Array.isArray(saved.state.root.children) ||
                !saved.state.headers ||
                typeof saved.state.dirty !== "boolean")
        )
            throw new Error("This tab's saved state could not be read. It has been kept open.");
        store = createTreeStore(id, initial ?? saved?.state);
        ownTabTree(store, id);
        stores.set(id, store);
    }
    return store;
}

export function releaseTabTreeStore(id: string) {
    stores.delete(id);
}
