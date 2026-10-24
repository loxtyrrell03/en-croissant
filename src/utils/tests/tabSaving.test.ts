import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { tabsAtom } from "@/state/atoms";
import { createTabSaveTarget } from "../tabSaveTarget";
import { ownTabTree } from "@/state/store/treeOwner";
import { saveToFile, type Tab } from "../tabs";
import { withPgnFileTask } from "../pgnFileQueue";

const io = vi.hoisted(() => ({
    dialog: vi.fn(),
    write: vi.fn(),
    writeDb: vi.fn(),
    exists: vi.fn(),
    sidecar: vi.fn(),
    copy: vi.fn(),
}));
vi.mock("@/state/atoms", () => ({ tabsAtom: atom<Tab[]>([]) }));
vi.mock("@/bindings", () => ({ commands: { writeGame: io.write, writeDbGame: io.writeDb } }));
vi.mock("@/bindings/pgnFiles", () => ({
    pgnFiles: {
        write: async (path: string, n: number, identity: string, pgn: string, metadata: string) => {
            const result = await io.write(path, n, pgn, identity, metadata);
            if (result.status === "error") throw new Error(result.error);
            return result.data ?? { file: path, index: n, identity: "b".repeat(64), gameCount: 4 };
        },
        create: async (path: string, pgn: string, metadata: string, source: unknown) => {
            const result = await io.write(path, 0, pgn, null, metadata, source);
            if (result.status === "error") throw new Error(result.error);
            return result.data ?? { file: path, index: 0, identity: "b".repeat(64), gameCount: 1 };
        },
    },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: io.dialog }));
vi.mock("@tauri-apps/api/path", () => ({
    resolve: async (...parts: string[]) => parts.join("/"),
    tempDir: async () => "/tmp/",
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
    copyFile: io.copy,
    exists: io.exists,
    writeTextFile: io.sidecar,
}));
vi.mock("@/utils/sound", () => ({ playSound: vi.fn() }));
vi.mock("@/utils/aiCoachPersistence", () => ({
    getAiCoachPersistenceTarget: () => null,
    getAiCoachSidecarPath: (path: string) => path + ".coach",
    loadPersistedAiCoachReview: vi.fn(),
    savePersistedAiCoachReview: vi.fn(),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const ok = { status: "ok", data: null };
function tab(id = "original", kind: "none" | "file" | "database" = "file"): Tab {
    return {
        value: id,
        name: id,
        type: "analysis",
        gameOrigin:
            kind === "none"
                ? { kind }
                : kind === "database"
                  ? { kind, database: "/library/fixture.db3", gameId: 17, sourceIdentity: "db-original" }
                  : {
                        kind,
                        gameNumber: 2,
                        sourceIdentity: "a".repeat(64),
                        file: {
                            type: "file",
                            name: "Fixture",
                            path: "/games/fixture.pgn",
                            numGames: 4,
                            lastModified: 1,
                            metadata: { type: "game", tags: [] },
                        },
                    },
    };
}
function setup(origin = tab()) {
    const atoms = createStore();
    atoms.set(tabsAtom, [origin, tab("other", "none")]);
    const tree = createTreeStore();
    tree.getState().setComment("Captured annotation");
    const target = createTabSaveTarget(atoms, origin.value);
    const request = (extra: Partial<Parameters<typeof saveToFile>[0]> = {}) =>
        saveToFile({ dir: "/documents", tab: origin, target, store: tree, ...extra });
    return { atoms, tree, target, request, origin };
}

beforeEach(() => {
    vi.resetAllMocks();
    io.write.mockResolvedValue(ok);
    io.writeDb.mockResolvedValue({ status: "ok", data: "db-written" });
    io.exists.mockResolvedValue(true);
    io.sidecar.mockResolvedValue(undefined);
    io.copy.mockResolvedValue(undefined);
    io.dialog.mockResolvedValue("/documents/saved.pgn");
});

describe("tab-owned saves", () => {
    it("refuses legacy database bindings without touching the row", async () => {
        const original = tab("original", "database");
        if (original.gameOrigin.kind === "database") delete original.gameOrigin.sourceIdentity;
        const state = setup(original);
        await expect(state.request()).rejects.toThrow("identity is missing");
        expect(io.writeDb).not.toHaveBeenCalled();
        expect(state.tree.getState().dirty).toBe(true);
        expect(state.target.get()).toEqual(original);
    });

    it("queues database snapshots with the identity from the preceding successful save", async () => {
        const state = setup(tab("original", "database"));
        const first = deferred<{ status: "ok"; data: string }>();
        io.writeDb.mockReturnValueOnce(first.promise);
        const saving = state.request();
        await vi.waitFor(() => expect(io.writeDb).toHaveBeenCalledOnce());
        state.tree.getState().setComment("Newer database annotation");
        const second = state.request();
        expect(io.writeDb.mock.calls[0][3]).toBe("db-original");
        first.resolve({ status: "ok", data: "first-written" });
        expect(await saving).toBe(true);
        expect(await second).toBe(true);
        expect(io.writeDb.mock.calls[1][3]).toBe("first-written");
        expect(io.writeDb.mock.calls[1][2]).toContain("Newer database annotation");
        expect(state.target.get()?.gameOrigin).toMatchObject({ sourceIdentity: "db-written" });
        expect(state.tree.getState().dirty).toBe(false);
    });

    it("keeps the database source identity and edits when saving a separate copy", async () => {
        const state = setup(tab("original", "database"));
        expect(await state.request({ isUserSave: true, forceSaveAs: true, copyOnly: true })).toBe(true);
        expect(io.writeDb).not.toHaveBeenCalled();
        expect(state.target.get()).toEqual(state.origin);
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("does not clean or rebind a different database game after a pending write", async () => {
        const state = setup(tab("original", "database"));
        const pending = deferred<{ status: "ok"; data: string }>();
        io.writeDb.mockReturnValueOnce(pending.promise);
        const saving = state.request();
        await vi.waitFor(() => expect(io.writeDb).toHaveBeenCalledOnce());
        state.target.update((tab) => ({ ...tab, gameOrigin: { kind: "database", database: "/other.db3", gameId: 99, sourceIdentity: "other-row" } }));
        pending.resolve({ status: "ok", data: "written-original" });
        expect(await saving).toBe(false);
        expect(state.target.get()?.gameOrigin).toMatchObject({ gameId: 99, sourceIdentity: "other-row" });
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("rechecks the binding after a preceding deletion before issuing a queued write", async () => {
        const state = setup();
        let finish!: () => void;
        const deletion = withPgnFileTask("/games/fixture.pgn", async () => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            state.target.update((tab) => ({ ...tab, gameOrigin: { kind: "none" } }));
        });
        await Promise.resolve();
        const saving = state.request();
        const rejection = saving.catch((error) => error);
        await Promise.resolve();
        expect(io.write).not.toHaveBeenCalled();
        finish();
        await deletion;
        expect(await rejection).toMatchObject({ message: expect.stringContaining("another game") });
        expect(io.write).not.toHaveBeenCalled();
        expect(state.tree.getState().dirty).toBe(true);
    });
    it("preserves file metadata edited while a write was pending", async () => {
        const state = setup();
        const done = deferred<typeof ok>();
        io.write.mockReturnValue(done.promise);
        const saving = state.request();
        await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
        state.target.update((tab) =>
            tab.gameOrigin.kind === "file"
                ? {
                      ...tab,
                      gameOrigin: {
                          ...tab.gameOrigin,
                          file: {
                              ...tab.gameOrigin.file,
                              name: "Updated name",
                              metadata: { type: "repertoire", tags: ["Keep"] },
                          },
                      },
                  }
                : tab,
        );
        done.resolve(ok);
        await saving;
        expect(state.target.get()?.gameOrigin).toMatchObject({
            file: { name: "Updated name", metadata: { type: "repertoire", tags: ["Keep"] } },
        });
    });
    it("refuses legacy file bindings without a captured identity while retaining a working copy path", async () => {
        const owner = tab();
        if (owner.gameOrigin.kind === "file") delete owner.gameOrigin.sourceIdentity;
        const state = setup(owner);
        await expect(state.request()).rejects.toThrow("identity is missing");
        expect(io.write).not.toHaveBeenCalled();
        expect(state.tree.getState().dirty).toBe(true);
        expect(await state.request({ forceSaveAs: true, copyOnly: true })).toBe(true);
        expect(state.tree.getState().dirty).toBe(true);
    });
    it("keeps a relocated native index and refreshed identity for the next save", async () => {
        const state = setup();
        io.write.mockResolvedValueOnce({
            status: "ok",
            data: { file: "/games/fixture.pgn", index: 7, identity: "c".repeat(64), gameCount: 8 },
        });
        expect(await state.request()).toBe(true);
        expect(state.target.get()?.gameOrigin).toMatchObject({
            gameNumber: 7,
            sourceIdentity: "c".repeat(64),
        });
        state.tree.getState().setComment("Another edit");
        expect(await state.request()).toBe(true);
        expect(io.write.mock.calls[1][1]).toBe(7);
        expect(io.write.mock.calls[1][3]).toBe("c".repeat(64));
    });
    it("binds the actual collision-safe filename returned by native creation", async () => {
        const state = setup(tab("original", "none"));
        io.write.mockResolvedValueOnce({
            status: "ok",
            data: {
                file: "/documents/saved (2).pgn",
                index: 0,
                identity: "c".repeat(64),
                gameCount: 1,
            },
        });
        expect(await state.request()).toBe(true);
        expect(state.target.get()?.gameOrigin).toMatchObject({
            sourceIdentity: "c".repeat(64),
            file: { path: "/documents/saved (2).pgn" },
        });
    });
    it("refuses a mismatched live board and tab owner", async () => {
        const state = setup();
        ownTabTree(state.tree, "other");
        await expect(state.request()).rejects.toThrow("different tab");
        expect(io.write).not.toHaveBeenCalled();
    });
    it.each(["file", "database"] as const)(
        "keeps %s changes dirty when the native command returns a failure",
        async (kind) => {
            const state = setup(tab("original", kind));
            (kind === "file" ? io.write : io.writeDb).mockResolvedValue({
                status: "error",
                error: "File locked",
            });
            await expect(state.request()).rejects.toThrow("File locked");
            expect(state.tree.getState().dirty).toBe(true);
            expect(state.target.get()).toEqual(state.origin);
        },
    );

    it("leaves a cancelled new-game save unbound and dirty", async () => {
        const state = setup(tab("original", "none"));
        io.dialog.mockResolvedValue(null);
        await expect(state.request({ isUserSave: true })).resolves.toBe(false);
        expect(io.write).not.toHaveBeenCalled();
        expect(state.target.get()?.gameOrigin.kind).toBe("none");
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("binds the requested owner after a delayed dialog and preserves edits made meanwhile", async () => {
        const state = setup(tab("original", "none"));
        const choice = deferred<string>();
        io.dialog.mockReturnValue(choice.promise);
        const saving = state.request({ isUserSave: true });
        await vi.waitFor(() => expect(io.dialog).toHaveBeenCalledOnce());
        state.tree.getState().setComment("Newer annotation");
        const other = state.atoms.get(tabsAtom)[1];
        choice.resolve("/documents/Chosen.PGN");
        expect(await saving).toBe(true);
        expect(io.write.mock.calls[0][0]).toBe("/documents/Chosen.PGN");
        expect(io.write.mock.calls[0][2]).toContain("Captured annotation");
        expect(io.write.mock.calls[0][2]).not.toContain("Newer annotation");
        expect(state.target.get()?.gameOrigin.kind).toBe("file");
        expect(state.atoms.get(tabsAtom)[1]).toBe(other);
        expect(state.tree.getState().root.comment).toBe("Newer annotation");
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("does not bind a new path when the write fails", async () => {
        const state = setup(tab("original", "none"));
        io.write.mockResolvedValue({ status: "error", error: "Disk full" });
        await expect(state.request({ isUserSave: true })).rejects.toThrow("Disk full");
        expect(state.target.get()?.gameOrigin.kind).toBe("none");
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("does not resurrect a closed tab or clear its dirty state after a late completion", async () => {
        const state = setup();
        const done = deferred<typeof ok>();
        io.write.mockReturnValue(done.promise);
        const saving = state.request();
        await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
        state.atoms.set(tabsAtom, (tabs) =>
            tabs.filter((item) => item.value !== state.origin.value),
        );
        done.resolve(ok);
        expect(await saving).toBe(false);
        expect(state.tree.getState().dirty).toBe(true);
        expect(state.atoms.get(tabsAtom).map((item) => item.value)).toEqual(["other"]);
    });

    it("refuses a changed game binding while a destination dialog is open", async () => {
        const state = setup();
        const choice = deferred<string>();
        io.dialog.mockReturnValue(choice.promise);
        const saving = state.request({ forceSaveAs: true });
        await vi.waitFor(() => expect(io.dialog).toHaveBeenCalledOnce());
        state.target.update((item) => ({ ...item, gameOrigin: { kind: "none" } }));
        choice.resolve("/documents/late.pgn");
        await expect(saving).rejects.toThrow("original game changed");
        expect(io.write).not.toHaveBeenCalled();
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("serializes writes and coalesces waiting automatic snapshots to the latest content", async () => {
        const state = setup();
        const first = deferred<typeof ok>();
        io.write.mockReturnValueOnce(first.promise).mockResolvedValue(ok);
        const a = state.request();
        await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
        state.tree.getState().setComment("Intermediate");
        const b = state.request();
        state.tree.getState().setComment("Latest");
        const c = state.request();
        expect(io.write).toHaveBeenCalledTimes(1);
        first.resolve(ok);
        expect(await Promise.all([a, b, c])).toEqual([true, true, true]);
        expect(io.write).toHaveBeenCalledTimes(2);
        expect(io.write.mock.calls[1][2]).toContain("Latest");
        expect(io.write.mock.calls[1][2]).not.toContain("Intermediate");
        expect(state.tree.getState().dirty).toBe(false);
    });

    it("reuses the first successful binding for a queued save instead of asking for another name", async () => {
        const state = setup(tab("original", "none"));
        const choice = deferred<string>();
        io.dialog.mockReturnValue(choice.promise);
        const a = state.request({ isUserSave: true });
        await vi.waitFor(() => expect(io.dialog).toHaveBeenCalledOnce());
        state.tree.getState().setComment("Latest after the first dialog");
        const b = state.request();
        choice.resolve("/documents/one.pgn");
        await Promise.all([a, b]);
        expect(io.dialog).toHaveBeenCalledOnce();
        expect(io.write).toHaveBeenCalledTimes(2);
        expect(io.write.mock.calls.map(([path]) => path)).toEqual([
            "/documents/one.pgn",
            "/documents/one.pgn",
        ]);
        expect(state.tree.getState().dirty).toBe(false);
    });

    it("saves an explicit copy without rebinding or marking the original game clean", async () => {
        const state = setup();
        expect(await state.request({ isUserSave: true, forceSaveAs: true, copyOnly: true })).toBe(
            true,
        );
        expect(io.write.mock.calls[0].slice(0, 2)).toEqual(["/documents/saved.pgn", 0]);
        expect(state.target.get()).toEqual(state.origin);
        expect(state.tree.getState().dirty).toBe(true);
    });

    it("ignores navigation changes when confirming the saved content", async () => {
        const state = setup();
        state.tree.getState().makeMove({ payload: "e4" });
        const done = deferred<typeof ok>();
        io.write.mockReturnValue(done.promise);
        const saving = state.request();
        await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
        state.tree.getState().goToStart();
        done.resolve(ok);
        expect(await saving).toBe(true);
        expect(state.tree.getState().dirty).toBe(false);
        expect(io.write.mock.calls[0][2]).toContain("e4");
    });

    it("preserves the complete annotated game, including variations, marks and a custom root", async () => {
        const state = setup();
        state.tree.getState().setFen("7k/8/8/8/8/8/8/K7 b - - 11 37");
        state.tree.getState().setComment("Root note");
        state.tree.getState().setShapes([{ orig: "h8", brush: "green" }]);
        state.tree.getState().makeMove({ payload: "Kg8" });
        state.tree.getState().setAnnotation("!");
        state.tree.getState().goToStart();
        state.tree.getState().makeMove({ payload: "Kh7" });
        state.tree.getState().setComment("Alternative");
        await state.request();
        const written = io.write.mock.calls[0][2];
        for (const text of [
            "7k/8/8/8/8/8/8/K7 b - - 11 37",
            "Root note",
            "%csl",
            "Kg8!",
            "Kh7",
            "Alternative",
        ])
            expect(written).toContain(text);
        expect(written).toContain("(");
    });
});
