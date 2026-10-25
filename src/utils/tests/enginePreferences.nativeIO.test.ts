import { expect, it, vi } from "vitest";
import { enginePreferences } from "../enginePreferences";
const files = vi.hoisted(() => ({
    data: new Map<string, string>(),
    failRename: true,
    failRead: false,
    hideExists: false,
    moved: vi.fn(),
    removed: vi.fn(),
}));
vi.mock("@/utils/directories", () => ({ getEnginesDir: async () => "C:/Synthetic/Engines" }));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: async (path: string) =>
        files.hideExists && path.endsWith("/engines.json") ? false : files.data.has(path),
    readTextFile: async (path: string) => {
        if (files.failRead) throw new Error("Read denied");
        if (!files.data.has(path)) throw new Error("Missing file");
        return files.data.get(path)!;
    },
    readDir: async (directory: string) =>
        [...files.data.keys()]
            .filter((path) => path.startsWith(`${directory}/`))
            .map((path) => ({ name: path.slice(directory.length + 1) })),
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
it("confirms absence before seeding and preserves an unreadable profile even when exists would return false", async () => {
    files.data.clear();
    files.failRead = false;
    files.hideExists = true;
    await enginePreferences.reload();
    expect(enginePreferences.getSnapshot().phase).toBe("missing");
    const path = "C:/Synthetic/Engines/engines.json",
        original = JSON.stringify([
            {
                type: "local",
                id: "protected",
                name: "Protected",
                version: "18",
                path: "C:/Synthetic/protected.exe",
            },
        ]);
    files.data.set(path, original);
    files.failRead = true;
    files.moved.mockClear();
    await expect(enginePreferences.reload()).rejects.toThrow("Read denied");
    await expect(enginePreferences.storage.setItem("engines", [])).rejects.toThrow("Read denied");
    expect(files.data.get(path)).toBe(original);
    expect(files.moved).not.toHaveBeenCalled();
});
