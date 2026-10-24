import { createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@mantine/notifications", () => ({ notifications: { show: io.toast } }));
afterEach(() => {
    localStorage.clear();
    vi.resetModules();
});
it("loads per-file Database/Compare and default choices before any panel mounts", async () => {
    localStorage.setItem(
        "database-panel-settings-by-file",
        JSON.stringify({ "C:/lesson.pgn": { source: { type: "local", value: "/wanted.db3" } } }),
    );
    localStorage.setItem(
        "database-compare-settings-by-file",
        JSON.stringify({
            "C:/lesson.pgn": {
                slots: [{ sourceValue: "/first.db3" }, { sourceValue: "/second.db3" }],
            },
        }),
    );
    localStorage.setItem(
        "default-database-source",
        JSON.stringify({ type: "local", value: "/default.db3" }),
    );
    localStorage.setItem("default-compare-databases", JSON.stringify(["/one.db3", "/two.db3"]));
    vi.resetModules();
    const state = await import("../atoms");
    const atoms = createStore();
    expect(atoms.get(state.databasePanelSettingsByFileAtom)["C:/lesson.pgn"].source).toEqual({
        type: "local",
        value: "/wanted.db3",
    });
    expect(atoms.get(state.comparePanelSettingsByFileAtom)["C:/lesson.pgn"].slots).toHaveLength(2);
    expect(atoms.get(state.defaultDatabaseSourceAtom)).toEqual({
        type: "local",
        value: "/default.db3",
    });
    expect(atoms.get(state.defaultCompareDatabasesAtom)).toEqual(["/one.db3", "/two.db3"]);
});
it("preserves corrupt durable settings when a panel attempts a later write", async () => {
    localStorage.setItem("database-panel-settings-by-file", "[]");
    vi.resetModules();
    const state = await import("../atoms");
    const atoms = createStore();
    expect(atoms.get(state.databasePanelSettingsByFileAtom)).toEqual({});
    expect(() => atoms.set(state.databasePanelSettingsByFileAtom, {})).toThrow("preserved");
    expect(localStorage.getItem("database-panel-settings-by-file")).toBe("[]");
});
