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
    it("replaces the stale Windows LC0 offer with the ChessBot engine and network", () => {
        const merged = mergeManagedEngineCatalog([staleLc0], "windows");

        expect(merged).toEqual([CHESSBOT_LC0_ENGINE]);
        expect(merged[0].version).toBe("0.32.1");
        expect(merged[0].managedInstall).toBe("chessbot-lc0-0.32.1");
        expect(merged[0].downloadSize).toBe(964_615_653);
    });

    it("leaves non-Windows catalogs unchanged", () => {
        expect(mergeManagedEngineCatalog([staleLc0], "linux")).toEqual([staleLc0]);
    });

    it("reconciles required installs without losing remote profiles or existing ids", () => {
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
            name: "Stockfish",
            loaded: true,
            settings: [
                { name: "Hash", value: 512 },
                { name: "Threads", value: 8 },
            ],
        });
        expect(merged[2]).toMatchObject({ name: "LCZero", loaded: true });
    });
});
