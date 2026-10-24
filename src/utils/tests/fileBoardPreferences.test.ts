import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { ownTabTree } from "@/state/store/treeOwner";
import {
    tabsAtom,
    recentFilesAtom,
    pinnedFileEntriesAtom,
    archivedFileEntriesAtom,
    databasePanelSettingsByFileAtom,
    comparePanelSettingsByFileAtom,
} from "@/state/atoms";
import { createTabSaveTarget } from "../tabSaveTarget";
import {
    FILE_BOARD_PREFERENCES_KEY,
    applyFileOrientation,
    flipBoardOrientation,
    loadFileBoardPreferences,
    moveFileBoardPreferences,
    saveFileBoardPreferences,
} from "../fileBoardPreferences";
import {
    filePreferenceIdentity,
    findWorkspacePreference,
    moveWorkspacePreferences,
} from "../workspacePreferences";
import { noteFileMove } from "../fileSourceMoves";
import { defaultTree } from "../treeReducer";
import { createTab, type Tab } from "../tabs";

const io = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
beforeEach(() => {
    localStorage.removeItem(FILE_BOARD_PREFERENCES_KEY);
    vi.restoreAllMocks();
    io.toast.mockClear();
});
const source: Tab = {
    value: "pref-owner",
    name: "Lesson",
    type: "analysis",
    gameOrigin: {
        kind: "file",
        sourceIdentity: "captured",
        gameNumber: 2,
        file: {
            type: "file",
            path: "C:\\Prep\\Lesson.pgn",
            name: "Lesson",
            numGames: 3,
            lastModified: 1,
            metadata: { type: "game", tags: ["Keep"] },
        },
    },
};
it("applies remembered file orientation when an actual source-bound tab opens", async () => {
    saveFileBoardPreferences("C:/Prep/Lesson.pgn", { orientation: "black" });
    const initial = defaultTree();
    initial.headers.orientation = "white";
    const id = await createTab({
        tab: { name: "Lesson", type: "analysis" },
        gameOrigin: source.gameOrigin,
        initialState: initial,
        setTabs: () => {},
        setActiveTab: () => {},
    });
    try {
        const stored = JSON.parse(sessionStorage.getItem(id)!).state;
        expect(stored.headers.orientation).toBe("black");
        expect(stored.dirty).toBe(false);
        expect(initial.headers.orientation).toBe("white");
    } finally {
        sessionStorage.removeItem(id);
    }
});
it("merges orientation and independent placement/mode sources without sharing files", () => {
    saveFileBoardPreferences("C:\\Prep\\Lesson.pgn", { orientation: "black" });
    saveFileBoardPreferences("c:/prep/lesson.pgn", {
        prepSources: {
            "side:general": { source: "lch_master", databasePath: null, databaseLabel: "Masters" },
            "underBoard:player": {
                source: "local",
                databasePath: "/other.db3",
                databaseLabel: "Opponent",
            },
        },
    });
    saveFileBoardPreferences("C:/Prep/Other.pgn", { orientation: "white" });
    expect(loadFileBoardPreferences("C:/PREP/Lesson.pgn")).toMatchObject({
        orientation: "black",
        prepSources: {
            "side:general": { source: "lch_master" },
            "underBoard:player": { databasePath: "/other.db3" },
        },
    });
    expect(loadFileBoardPreferences("C:/Prep/Other.pgn")?.orientation).toBe("white");
    expect(filePreferenceIdentity("\\\\?\\C:\\Prep\\Lesson.pgn")).toBe("c:/prep/lesson.pgn");
    expect(filePreferenceIdentity("/home/Prep/A.pgn")).not.toBe(
        filePreferenceIdentity("/home/prep/a.pgn"),
    );
});
it("preserves malformed or unwritable durable preferences", () => {
    localStorage.setItem(FILE_BOARD_PREFERENCES_KEY, "[]");
    expect(() => saveFileBoardPreferences("C:/A.pgn", { orientation: "black" })).toThrow(
        "preserved",
    );
    expect(localStorage.getItem(FILE_BOARD_PREFERENCES_KEY)).toBe("[]");
    localStorage.removeItem(FILE_BOARD_PREFERENCES_KEY);
    saveFileBoardPreferences("C:/A.pgn", { orientation: "black" });
    const before = localStorage.getItem(FILE_BOARD_PREFERENCES_KEY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage full");
    });
    expect(() => saveFileBoardPreferences("C:/A.pgn", { orientation: "white" })).toThrow(
        "Storage full",
    );
    expect(localStorage.getItem(FILE_BOARD_PREFERENCES_KEY)).toBe(before);
});
it("rejects unsupported Prep sources before damaging the stored map", () => {
    saveFileBoardPreferences("C:/A.pgn", { orientation: "black" });
    const before = localStorage.getItem(FILE_BOARD_PREFERENCES_KEY);
    expect(() =>
        saveFileBoardPreferences("C:/A.pgn", {
            prepSources: {
                "side:player": { source: "lch_all", databasePath: null, databaseLabel: null },
            },
        }),
    ).toThrow("preserved");
    expect(localStorage.getItem(FILE_BOARD_PREFERENCES_KEY)).toBe(before);
});
it("restores a remembered view without changing moves, annotations, FEN or dirty state", () => {
    saveFileBoardPreferences("C:/Prep/Lesson.pgn", { orientation: "black" });
    const original = defaultTree("7k/6pp/8/8/8/8/6PP/KR6 b - - 0 37");
    original.root.comment = "Root note";
    original.headers.orientation = "white";
    const restored = applyFileOrientation(original, "C:\\Prep\\Lesson.pgn");
    expect(restored.headers.orientation).toBe("black");
    expect(restored.root).toBe(original.root);
    expect(restored.report).toBe(original.report);
    expect(restored.dirty).toBe(false);
    expect(original.headers.orientation).toBe("white");
    expect(applyFileOrientation(original, "C:/New.pgn")).toBe(original);
});
it("flips only presentation state, remembers the latest owned source path and retains edits", () => {
    const atoms = createStore();
    atoms.set(tabsAtom, [source]);
    const tree = createTreeStore();
    ownTabTree(tree, source.value);
    const root = tree.getState().root;
    const target = createTabSaveTarget(atoms, source.value);
    flipBoardOrientation(tree, target);
    expect(tree.getState().headers.orientation).toBe("black");
    expect(tree.getState().dirty).toBe(false);
    expect(tree.getState().root).toBe(root);
    expect(loadFileBoardPreferences("C:/Prep/Lesson.pgn")?.orientation).toBe("black");
    tree.getState().setComment("Unsaved annotation");
    flipBoardOrientation(tree, target);
    expect(tree.getState().dirty).toBe(true);
    expect(tree.getState().root.comment).toBe("Unsaved annotation");
    expect(loadFileBoardPreferences("C:/Prep/Lesson.pgn")?.orientation).toBe("white");
});
it("does not store a preview board's flip against another tab's file", () => {
    const atoms = createStore();
    atoms.set(tabsAtom, [source]);
    const tree = createTreeStore();
    ownTabTree(tree, "different-owner");
    flipBoardOrientation(tree, createTabSaveTarget(atoms, source.value));
    expect(loadFileBoardPreferences("C:/Prep/Lesson.pgn")).toBeUndefined();
});
it("moves folder preferences at path boundaries and keeps native database-row scopes", () => {
    saveFileBoardPreferences("C:/Prep/Lesson.pgn", { orientation: "black" });
    saveFileBoardPreferences("C:/Preparation/Other.pgn", { orientation: "white" });
    moveFileBoardPreferences("c:\\prep", "C:/Monday", true);
    expect(loadFileBoardPreferences("C:/Monday/Lesson.pgn")?.orientation).toBe("black");
    expect(loadFileBoardPreferences("C:/Prep/Lesson.pgn")).toBeUndefined();
    expect(loadFileBoardPreferences("C:/Preparation/Other.pgn")?.orientation).toBe("white");
    const values = {
        "C:\\Prep\\Lesson.pgn": { source: 1 },
        "C:\\Prep\\Lesson.pgn::under-board-database": { source: 2 },
        "database:C:/Prep/data.db3:12": { source: 3 },
    };
    const moved = moveWorkspacePreferences(values, "C:/Prep", "C:/Monday", true);
    expect(findWorkspacePreference(moved, "c:/monday/lesson.pgn::under-board-database")).toEqual({
        source: 2,
    });
    expect(moved["database:C:/Prep/data.db3:12"]).toEqual({ source: 3 });
});
it("rebinds open source identities and preferences after a move, without losing board edits", () => {
    const atoms = createStore();
    atoms.set(tabsAtom, [source, { ...source, value: "custom", name: "Custom tab title" }]);
    atoms.set(recentFilesAtom, [
        { path: "C:/Prep/Lesson.pgn", name: "Lesson", type: "game", lastOpened: 1 },
    ]);
    atoms.set(pinnedFileEntriesAtom, ["C:/Prep/Lesson.pgn"]);
    atoms.set(archivedFileEntriesAtom, ["C:/Prep"]);
    const database = {
        source: { type: "lch_all" },
        localOptions: {},
        lichessOptions: {},
        masterOptions: {},
        moveHealthSide: "sideToMove",
        tabType: "stats",
    } as never;
    const compare = {
        slots: [],
        lichessOptions: {},
        masterOptions: {},
        moveHealthSide: "sideToMove",
    } as never;
    atoms.set(databasePanelSettingsByFileAtom, {
        "C:\\Prep\\Lesson.pgn": database,
        "C:\\Prep\\Lesson.pgn::under-board-database": database,
    });
    atoms.set(comparePanelSettingsByFileAtom, { "C:/Prep/Lesson.pgn": compare });
    saveFileBoardPreferences("C:/Prep/Lesson.pgn", { orientation: "black" });
    noteFileMove(atoms, "C:/Prep", "C:/Monday", true);
    expect(atoms.get(tabsAtom)[0].gameOrigin).toMatchObject({
        sourceIdentity: "captured",
        gameNumber: 2,
        file: { path: "C:/Monday/Lesson.pgn", metadata: { tags: ["Keep"] } },
    });
    expect(atoms.get(tabsAtom)[1].name).toBe("Custom tab title");
    expect(atoms.get(recentFilesAtom)[0].path).toBe("C:/Monday/Lesson.pgn");
    expect(atoms.get(pinnedFileEntriesAtom)).toEqual(["C:/Monday/Lesson.pgn"]);
    expect(atoms.get(archivedFileEntriesAtom)).toEqual(["C:/Monday"]);
    expect(
        findWorkspacePreference(
            atoms.get(databasePanelSettingsByFileAtom),
            "c:/monday/lesson.pgn::under-board-database",
        ),
    ).toBe(database);
    expect(
        findWorkspacePreference(atoms.get(comparePanelSettingsByFileAtom), "C:/Monday/Lesson.pgn"),
    ).toBe(compare);
    expect(loadFileBoardPreferences("C:/Monday/Lesson.pgn")?.orientation).toBe("black");
});
