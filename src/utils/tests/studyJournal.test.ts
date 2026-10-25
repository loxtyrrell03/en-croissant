import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyJournal, ensureStudyDay } from "../studySession";
import { dailyStudyPlanSchema } from "../dailyStudyPlan";
import {
    loadStudyAdaptation,
    loadStudyJournal,
    studyFileId,
    studyJournalPath,
    writeStudyJournal,
} from "../studyJournal";
const mocks = vi.hoisted(() => ({ files: new Map<string, string>(), failRename: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...p: string[]) => p.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: async (p: string) => mocks.files.has(p),
    mkdir: async () => {},
    readDir: async () => [],
    readTextFile: async (p: string) => {
        if (!mocks.files.has(p)) throw Error("missing");
        return mocks.files.get(p);
    },
    writeTextFile: async (p: string, s: string) => {
        mocks.files.set(p, s);
    },
    rename: async (a: string, b: string) => {
        if (mocks.failRename) throw Error("disk error");
        mocks.files.set(b, mocks.files.get(a)!);
        mocks.files.delete(a);
    },
}));
beforeEach(() => {
    mocks.files.clear();
    mocks.failRename = false;
    Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request: async (_key: string, fn: () => Promise<unknown>) => fn() },
    });
});
describe("durable study journal files", () => {
    it("validates five-minute adjustments against the capped daily schedule and rejects stale evidence", async () => {
        const plan = dailyStudyPlanSchema.parse({
            schemaVersion: 1,
            id: "test",
            title: "Study",
            startDate: "2026-10-01",
            steps: [
                {
                    id: "calculation",
                    title: "Calculation",
                    minutes60: 30,
                    minutes90: 45,
                    instructions: "Calculate",
                },
                {
                    id: "opening",
                    title: "Opening",
                    minutes60: 25,
                    minutes90: 40,
                    instructions: "Recall",
                },
                {
                    id: "endgames",
                    title: "Endgames",
                    minutes60: 5,
                    minutes90: 5,
                    instructions: "Practise",
                },
            ],
            priorities: {
                daily: [],
                adaptive: ["opening", "calculation"],
                weeklyCaps: { endgames: 2 },
            },
        });
        const j = emptyJournal(plan.id);
        ensureStudyDay(j, plan, "2026-10-19", 60);
        ensureStudyDay(j, plan, "2026-10-21", 90);
        await writeStudyJournal("/Study", j, 0);
        const adjusted = structuredClone(plan);
        Object.assign(adjusted.steps[0], { minutes60: 25, minutes90: 40 });
        Object.assign(adjusted.steps[1], { minutes60: 35, minutes90: 50 });
        Object.assign(adjusted.steps[2], { minutes60: 0, minutes90: 0 });
        const path = `/Study/Study history/adaptation-${studyFileId(plan.id)}-2026-10-24.json`;
        const value = {
            schemaVersion: 1,
            date: "2026-10-24",
            planId: plan.id,
            journalRevision: 1,
            createdAt: new Date().toISOString(),
            reason: "Bounded adjustment",
            basePlan: plan,
            plan: adjusted,
        };
        mocks.files.set(path, JSON.stringify(value));
        expect((await loadStudyAdaptation("/Study", plan, value.date))?.plan).toEqual(adjusted);
        value.journalRevision = 0;
        mocks.files.set(path, JSON.stringify(value));
        await expect(loadStudyAdaptation("/Study", plan, value.date)).rejects.toThrow(
            "history changed",
        );
    });
    it("atomically saves and reads back, then refuses an obsolete revision", async () => {
        const j = emptyJournal("test");
        const saved = await writeStudyJournal("/Study", j, 0);
        expect(saved.revision).toBe(1);
        expect(await loadStudyJournal("/Study", "test")).toEqual(saved);
        await expect(writeStudyJournal("/Study", j, 0)).rejects.toThrow("another window");
    });
    it("retains the previous authoritative file when replacement fails", async () => {
        const j = await writeStudyJournal("/Study", emptyJournal("test"), 0);
        const path = await studyJournalPath("/Study", "test");
        const before = mocks.files.get(path);
        mocks.failRename = true;
        await expect(
            writeStudyJournal("/Study", { ...j, legacyImported: true }, 1),
        ).rejects.toThrow("disk error");
        expect(mocks.files.get(path)).toBe(before);
    });
    it("refuses corrupt or mismatched history without overwriting it", async () => {
        const path = await studyJournalPath("/Study", "test");
        mocks.files.set(path, "corrupt");
        await expect(writeStudyJournal("/Study", emptyJournal("test"), 0)).rejects.toThrow();
        expect(mocks.files.get(path)).toBe("corrupt");
        mocks.files.set(path, JSON.stringify(emptyJournal("foreign")));
        await expect(loadStudyJournal("/Study", "test")).rejects.toThrow("different plan");
    });
    it("never falls back to browser storage when native locking is missing", async () => {
        Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
        await expect(writeStudyJournal("/Study", emptyJournal("test"), 0)).rejects.toThrow(
            "locking",
        );
        expect(mocks.files.size).toBe(0);
    });
});
