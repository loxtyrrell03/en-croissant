import { describe, expect, it } from "vitest";
import {
    CHESSBOT_LC0_ENGINE,
    type Engine,
    type LocalEngine,
    mergeInstalledDesktopEngines,
    mergeManagedEngineCatalog,
} from "../engines";

const staleLc0: LocalEngine = {
    type: "local",
    id: "old-lc0",
    name: "Leela Chess Zero",
    version: "0.30.0",
    path: "lc0-v0.30.0-windows-gpu-nvidia-cuda/lc0.exe",
};

describe("managed engine catalog", () => {
    it("does not repoint an owner-selected path because its ID matches a managed install", () => {
        const current: LocalEngine = {
            type: "local",
            id: "managed-stockfish-18",
            name: "Owner choice",
            version: "19",
            path: "C:/Owner/stockfish-19.exe",
            loaded: false,
        };
        const installed: LocalEngine = {
            ...current,
            version: "18",
            path: "C:/Programs/Stockfish/18.exe",
            loaded: true,
        };
        expect(mergeInstalledDesktopEngines([current], [installed])).toEqual([current]);
    });
    it.each([
        ["20", "19"],
        ["0.33.0", "0.32.1"],
    ])("does not downgrade saved version %s to discovered %s", (saved, older) => {
        const current: LocalEngine = {
            type: "local",
            id: "owner",
            name: "Newer owner engine",
            version: saved,
            path: "C:/Owner/engine.exe",
            loaded: false,
        };
        const installed: LocalEngine = { ...current, id: "managed", version: older, loaded: true };
        expect(mergeInstalledDesktopEngines([current], [installed])).toEqual([current]);
    });
    it("replaces the stale Windows LC0 offer with the ChessBot engine and network", () => {
        const merged = mergeManagedEngineCatalog([staleLc0], "windows");

        expect(merged).toEqual([CHESSBOT_LC0_ENGINE]);
        expect(merged[0].version).toBe("0.32.1");
        expect(merged[0].managedInstall).toBe("chessbot-lc0-0.32.1");
        expect(merged[0].downloadSize).toBe(964_615_653);
        expect(merged[0].elo).toBeNull();
    });

    it("replaces old official Windows Stockfish offers with the separately pinned built-in card while retaining forks", () => {
        const fork: LocalEngine = { ...staleLc0, id: "fairy", name: "Fairy Stockfish", path: "fairy.exe" };
        expect(mergeManagedEngineCatalog([{ ...fork, name: "Stockfish", version: "18" }, { ...fork, name: "Stockfish 19" }, fork], "windows")).toEqual([fork, CHESSBOT_LC0_ENGINE]);
    });

    it("leaves non-Windows catalogs unchanged", () => {
        expect(mergeManagedEngineCatalog([staleLc0], "linux")).toEqual([staleLc0]);
    });

    it("fills installed-engine defaults without losing owner labels, settings, visibility or remote profiles", () => {
        const current: Engine[] = [
            {
                type: "pc",
                id: "pc-lc0",
                name: "PC LC0",
                url: "http://127.0.0.1:1",
                engineKind: "lc0",
            },
            {
                type: "local",
                id: "user-stockfish-id",
                name: "Old label",
                version: "18",
                path: "C:\\Engines\\Stockfish.exe",
                loaded: false,
                go: { t: "Time", c: 200 },
                settings: [{ name: "Hash", value: 128 }],
            },
        ];
        const installed: LocalEngine[] = [
            {
                type: "local",
                id: "managed-stockfish-18",
                name: "Stockfish",
                version: "18",
                path: "c:/engines/stockfish.exe",
                loaded: true,
                settings: [
                    { name: "Hash", value: 512 },
                    { name: "Threads", value: 8 },
                ],
            },
            {
                type: "local",
                id: "managed-lc0",
                name: "LCZero",
                version: "0.32.1",
                path: "C:/engines/lc0.exe",
                loaded: true,
            },
        ];

        const merged = mergeInstalledDesktopEngines(current, installed);

        expect(merged).toHaveLength(3);
        expect(merged[0]).toEqual(current[0]);
        expect(merged[1]).toMatchObject({
            id: "user-stockfish-id",
            name: "Old label",
            loaded: false,
            go: { t: "Time", c: 200 },
            settings: [
                { name: "Hash", value: 128 },
                { name: "Threads", value: 8 },
            ],
        });
        expect(merged[2]).toMatchObject({ name: "LCZero", loaded: true });
    });
});
