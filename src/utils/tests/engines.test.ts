import { describe, expect, it } from "vitest";
import {
    CHESSBOT_LC0_ENGINE,
    type LocalEngine,
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
});
