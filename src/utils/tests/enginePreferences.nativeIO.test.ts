import { expect, it, vi } from "vitest";
import { enginePreferences } from "../enginePreferences";
const files = vi.hoisted(() => ({
    data: new Map<string, string>(),
    failRename: true,
    moved: vi.fn(),
    removed: vi.fn(),
}));
vi.mock("@/utils/directories", () => ({ getEnginesDir: async () => "C:/Synthetic/Engines" }));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: async (path: string) => files.data.has(path),
    readTextFile: async (path: string) => files.data.get(path)!,
    writeTextFile: async (path: string, text: string) => {
        files.data.set(path, text);
    },
    rename: async (from: string, to: string) => {
        files.moved(from, to);
        if (files.failRename) throw new Error("File locked");
        files.data.set(to, files.data.get(from)!);
        files.data.delete(from);
    },
    remove: async (path: string) => {
        files.removed(path);
        files.data.delete(path);
    },
}));
it("keeps the original native profile until replacement succeeds and removes only its own temporary file", async () => {
    const path = "C:/Synthetic/Engines/engines.json";
    files.data.set(path, "[]");
    await enginePreferences.storage.getItem("engines", []);
    await expect(
        enginePreferences.storage.setItem("engines", [
            {
                type: "local",
                id: "fixture",
                name: "Fixture",
                version: "18",
                path: "C:/Synthetic/engine.exe",
            },
        ]),
    ).rejects.toThrow("File locked");
    expect(files.data.get(path)).toBe("[]");
    expect([...files.data.keys()]).toEqual([path]);
    expect(files.removed.mock.calls[0][0]).toMatch(
        /^C:\/Synthetic\/Engines\/engines\.json\.[\w-]+\.tmp$/,
    );
    files.failRename = false;
    await enginePreferences.retry();
    await enginePreferences.flush();
    expect(JSON.parse(files.data.get(path)!)[0].id).toBe("fixture");
    expect([...files.data.keys()]).toEqual([path]);
});
