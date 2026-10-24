import { beforeEach, expect, it, vi } from "vitest";
import { createTab, type Tab } from "../tabs";
import { defaultTree } from "../treeReducer";
import { pgnFiles } from "@/bindings/pgnFiles";
vi.mock("@/bindings/pgnFiles", () => ({ pgnFiles: { read: vi.fn() } }));
vi.mock("../chess", () => ({ parsePGN: async () => defaultTree() }));
vi.mock("../onlinePgnClocks", () => ({ hydrateOnlinePgnClocks: async (pgn: string) => pgn }));
const origin: Tab["gameOrigin"] = {
    kind: "file",
    gameNumber: 0,
    file: {
        type: "file",
        name: "Recent",
        path: "/recent.pgn",
        numGames: 2,
        lastModified: 1,
        metadata: { type: "game", tags: [] },
    },
};
beforeEach(() =>
    vi
        .mocked(pgnFiles.read)
        .mockResolvedValue({
            pgn: "Native snapshot",
            identity: "native-id",
            index: 0,
            gameCount: 3,
        }),
);
it("captures identities for direct recent-file and repertoire tab entry points", async () => {
    let tab: Tab | undefined;
    const id = await createTab({
        tab: { name: "Recent", type: "analysis" },
        gameOrigin: origin,
        pgn: "Native snapshot",
        setTabs: (update) => {
            if (typeof update === "function") tab = update([])[0];
        },
        setActiveTab: () => {},
    });
    try {
        expect(tab?.gameOrigin).toMatchObject({
            sourceIdentity: "native-id",
            file: { numGames: 3 },
        });
    } finally {
        sessionStorage.removeItem(id);
    }
});
it("refuses stale direct-tab PGN text rather than attaching it to the current file slot", async () => {
    const setTabs = vi.fn();
    await expect(
        createTab({
            tab: { name: "Recent", type: "analysis" },
            gameOrigin: origin,
            pgn: "Old text",
            setTabs,
            setActiveTab: () => {},
        }),
    ).rejects.toThrow("PGN changed");
    expect(setTabs).not.toHaveBeenCalled();
});
