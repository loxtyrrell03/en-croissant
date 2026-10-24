import { beforeEach, expect, it, vi } from "vitest";
import { atom } from "jotai";
import { defaultTree } from "../treeReducer";
import { openFile } from "../files";
import { createTab } from "../tabs";
import { pgnFiles } from "@/bindings/pgnFiles";
import { hydrateOnlinePgnClocks } from "../onlinePgnClocks";

vi.mock("@/bindings/pgnFiles", () => ({ pgnFiles: { read: vi.fn() } }));
vi.mock("../tabs", async (original) => ({
    ...(await original<typeof import("../tabs")>()),
    createTab: vi.fn(),
    isInTempDir: async () => false,
}));
vi.mock("../onlinePgnClocks", () => ({ hydrateOnlinePgnClocks: vi.fn() }));
vi.mock("../chess", () => ({
    parsePGN: async (pgn: string) => ({
        ...defaultTree(),
        root: { ...defaultTree().root, comment: pgn },
    }),
}));
vi.mock("@/state/atoms", () => ({
    addRecentFileAtom: atom(null),
    tabFamily: () => atom("analysis"),
}));
vi.mock("@tauri-apps/plugin-log", () => ({ warn: vi.fn() }));
beforeEach(() => {
    vi.mocked(pgnFiles.read).mockReset();
    vi.mocked(createTab).mockReset();
    vi.mocked(pgnFiles.read).mockResolvedValue({
        pgn: "Captured source",
        identity: "native-id",
        index: 2,
        gameCount: 7,
    });
    vi.mocked(hydrateOnlinePgnClocks).mockImplementation(async (pgn) => pgn);
});
it("opens the fresh source snapshot and captures its identity and actual count", async () => {
    await openFile(
        "C:\\games.pgn",
        () => {},
        () => {},
        { gameNumber: 2 },
    );
    const request = vi.mocked(createTab).mock.calls[0][0];
    expect(request.gameOrigin).toMatchObject({
        sourceIdentity: "native-id",
        gameNumber: 2,
        file: { numGames: 7 },
    });
    expect(request.initialState?.root.comment).toBe("Captured source");
});
it("refuses stale preview text or identity without creating a wrongly bound board", async () => {
    await expect(
        openFile(
            "C:\\games.pgn",
            () => {},
            () => {},
            { gameNumber: 2, pgn: "Old preview" },
        ),
    ).rejects.toThrow("PGN changed");
    await expect(
        openFile(
            "C:\\games.pgn",
            () => {},
            () => {},
            { gameNumber: 2, expectedIdentity: "old-id" },
        ),
    ).rejects.toThrow("PGN changed");
    expect(createTab).not.toHaveBeenCalled();
});
it("keeps hydrated clock edits in memory with the original source identity", async () => {
    vi.mocked(hydrateOnlinePgnClocks).mockResolvedValue("Added clocks");
    await openFile(
        "C:\\games.pgn",
        () => {},
        () => {},
        { gameNumber: 2 },
    );
    const request = vi.mocked(createTab).mock.calls[0][0];
    expect(request.initialState).toMatchObject({ dirty: true, root: { comment: "Added clocks" } });
    expect(request.gameOrigin).toMatchObject({ sourceIdentity: "native-id" });
});
