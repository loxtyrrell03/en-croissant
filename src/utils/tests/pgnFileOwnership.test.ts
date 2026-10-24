import { atom, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pgnFiles } from "@/bindings/pgnFiles";
import { tabsAtom } from "@/state/atoms";
import { getTabTreeStore, releaseTabTreeStore } from "@/state/store/treeRegistry";
import { removeDebouncedSessionStorageItem } from "@/state/store/debouncedStorage";
import { appendTabGame } from "../appendTabGame";
import { notePgnFileWrite } from "../pgnSourceTabs";
import { createTabSaveTarget } from "../tabSaveTarget";
import type { Tab } from "../tabs";

vi.mock("@/state/atoms", () => ({ tabsAtom: atom<Tab[]>([]) }));
vi.mock("@/bindings/pgnFiles", () => ({ pgnFiles: { append: vi.fn() } }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
const ids = ["file-owner", "same-source", "following-game", "other-file"];
const tab = (value: string, index: number, identity: string, path = "C:\\games.pgn"): Tab => ({
    value,
    name: value,
    type: "analysis",
    gameOrigin: {
        kind: "file",
        gameNumber: index,
        sourceIdentity: identity,
        file: {
            type: "file",
            path,
            name: "Games",
            numGames: 3,
            lastModified: 1,
            metadata: { type: "game", tags: [] },
        },
    },
});
beforeEach(() => {
    vi.mocked(pgnFiles.append).mockReset();
});
afterEach(() => {
    for (const id of ids) {
        releaseTabTreeStore(id);
        removeDebouncedSessionStorageItem(id);
    }
});
function setup() {
    const store = createStore();
    store.set(tabsAtom, [
        tab(ids[0], 1, "old"),
        tab(ids[1], 1, "old"),
        tab(ids[2], 2, "next"),
        tab(ids[3], 1, "old", "C:\\other.pgn"),
    ]);
    const tree = getTabTreeStore(ids[0]);
    tree.getState().setComment("Unsaved board note");
    return { store, tree, target: createTabSaveTarget(store, ids[0]) };
}
it("deleting a source retains open board edits and adjusts only that file's neighbours", () => {
    const view = setup();
    notePgnFileWrite(
        view.store,
        "c:/games.pgn",
        { file: "C:\\games.pgn", index: 1, identity: "", gameCount: 2 },
        { requestedIndex: 1, identity: "old" },
    );
    expect(view.target.get()?.gameOrigin.kind).toBe("none");
    expect(view.store.get(tabsAtom)[1].gameOrigin.kind).toBe("none");
    expect(view.store.get(tabsAtom)[2].gameOrigin).toMatchObject({
        gameNumber: 1,
        file: { numGames: 2 },
    });
    expect(view.store.get(tabsAtom)[3].gameOrigin).toMatchObject({
        gameNumber: 1,
        file: { numGames: 3 },
    });
    expect(view.tree.getState().root.comment).toBe("Unsaved board note");
    expect(view.tree.getState().dirty).toBe(true);
});
it("does not detach a different indexed copy with identical PGN text", () => {
    const view = setup();
    view.store.set(tabsAtom, [tab(ids[0], 0, "same"), tab(ids[1], 1, "same")]);
    notePgnFileWrite(
        view.store,
        "C:\\games.pgn",
        { file: "C:\\games.pgn", index: 0, identity: "", gameCount: 1 },
        { requestedIndex: 0, identity: "same" },
    );
    expect(view.store.get(tabsAtom)[1].gameOrigin).toMatchObject({
        kind: "file",
        sourceIdentity: "same",
        gameNumber: 0,
    });
});
it("cancellation or failed saving prevents appending and retains the current tree", async () => {
    const view = setup();
    expect(
        await appendTabGame(
            view.target,
            view.tree,
            async () => false,
            () => {},
        ),
    ).toBe(false);
    expect(pgnFiles.append).not.toHaveBeenCalled();
    expect(view.tree.getState().root.comment).toBe("Unsaved board note");
});
it("appends at the native returned index and binds the requesting tab after saving", async () => {
    const view = setup();
    vi.mocked(pgnFiles.append).mockResolvedValue({
        file: "C:\\games.pgn",
        index: 4,
        identity: "new",
        gameCount: 5,
    });
    expect(
        await appendTabGame(
            view.target,
            view.tree,
            async () => {
                view.tree.getState().save();
                return true;
            },
            (path, result) => notePgnFileWrite(view.store, path, result),
        ),
    ).toBe(true);
    expect(view.target.get()?.gameOrigin).toMatchObject({
        gameNumber: 4,
        sourceIdentity: "new",
        file: { numGames: 5 },
    });
    expect(view.tree.getState().root.comment).toBe("");
    expect(view.store.get(tabsAtom)[1].gameOrigin).toMatchObject({ gameNumber: 1 });
});
it("cannot reset edits made during an append", async () => {
    const view = setup();
    view.tree.getState().save();
    vi.mocked(pgnFiles.append).mockImplementation(async () => {
        view.tree.getState().setComment("Newer note");
        return { file: "C:\\games.pgn", index: 3, identity: "new", gameCount: 4 };
    });
    await expect(
        appendTabGame(
            view.target,
            view.tree,
            async () => true,
            () => {},
        ),
    ).rejects.toThrow("current changes are still open");
    expect(view.tree.getState().root.comment).toBe("Newer note");
    expect(view.target.get()?.gameOrigin).toMatchObject({ gameNumber: 1, sourceIdentity: "old" });
});
