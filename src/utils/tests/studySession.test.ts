import { describe, expect, it } from "vitest";
import { dailyStudyPlanSchema } from "../dailyStudyPlan";
import {
    completeStudyStep,
    emptyJournal,
    ensureStudyDay,
    nextStudyStep,
    pauseAttempt,
    restartStudyStep,
    seekStudyTimer,
    selectStudyStep,
    settleJournal,
    studyDayEnd,
    studyElapsed,
    studyJournalSchema,
    studyTimerElapsed,
} from "../studySession";
import { importLegacyStudy } from "../studyJournal";
import { planForStudyDay, proposeStudyAdjustment } from "../studyPlanning";
import { exerciseChoices, validStudyFen } from "@/components/tabs/StudyWorkEditor";
import { studyHistoryRange } from "@/components/tabs/StudyHistory";
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
        { id: "opening", title: "Opening", minutes60: 30, minutes90: 45, instructions: "Recall" },
    ],
    priorities: { daily: [], adaptive: ["calculation", "opening"], weeklyCaps: {} },
});
const time = Date.parse("2026-10-24T12:00:00Z");
function setup() {
    const j = emptyJournal(plan.id);
    ensureStudyDay(j, plan, "2026-10-24", 60);
    return j;
}
describe("study journal semantics", () => {
    it("seeks both ways while retaining only actual running time across saves and expiry", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "calculation", time);
        a.runningSince = time;
        seekStudyTimer(a, 15 * 60000, time + 60000);
        expect(studyElapsed(a, time + 60000)).toBe(60000);
        expect(studyTimerElapsed(a, time + 60000)).toBe(15 * 60000);
        const restored = studyJournalSchema.parse(JSON.parse(JSON.stringify(j)));
        const b = restored.attempts[0];
        seekStudyTimer(b, 0, time + 2 * 60000);
        expect(b.elapsedMs).toBe(2 * 60000);
        expect(studyTimerElapsed(b, time + 2 * 60000)).toBe(0);
        settleJournal(restored, time + 40 * 60000);
        expect(b.elapsedMs).toBe(32 * 60000);
        expect(studyTimerElapsed(b, time + 40 * 60000)).toBe(30 * 60000);
        expect(b.runningSince).toBeNull();
        expect(restored.days[b.day].completed).toEqual([]);
    });
    it("clamps seeks, keeps paused timers paused and can resume after seeking back from expiry", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "calculation", time);
        seekStudyTimer(a, Number.NaN, time);
        expect(a.timerOffsetMs).toBeUndefined();
        seekStudyTimer(a, -1000, time);
        expect(studyTimerElapsed(a, time)).toBe(0);
        expect(a.runningSince).toBeNull();
        a.runningSince = time;
        seekStudyTimer(a, Number.MAX_VALUE, time + 1000);
        expect(a.runningSince).toBeNull();
        expect(a.elapsedMs).toBe(1000);
        seekStudyTimer(a, 0, time + 2000);
        expect(studyTimerElapsed(a, time + 2000)).toBe(0);
        a.runningSince = time + 2000;
        expect(studyTimerElapsed(a, time + 3000)).toBe(1000);
        expect(studyElapsed(a, time + 3000)).toBe(2000);
    });
    it("resumes saved partials and restarts just one block while retaining its old work", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "calculation", time);
        a.notes = "Keep my calculation";
        a.elapsedMs = 60000;
        a.status = "partial";
        j.days[a.day].current = null;
        expect(selectStudyStep(j, a.day, a.stepId, time + 1).id).toBe(a.id);
        expect(a.status).toBe("paused");
        a.runningSince = time + 1;
        const other = selectStudyStep(j, a.day, "opening", time + 1001);
        completeStudyStep(j, a.day, other.id, time + 1001);
        const b = restartStudyStep(j, a.day, a.stepId, time + 1002);
        expect(b).toMatchObject({ elapsedMs: 0, runningSince: null, notes: "", status: "paused" });
        expect(b.id).not.toBe(a.id);
        expect(a).toMatchObject({
            elapsedMs: 61000,
            notes: "Keep my calculation",
            status: "partial",
        });
        expect(j.days[a.day].completed).toEqual(["opening"]);
        const c = restartStudyStep(j, other.day, other.stepId, time + 1003);
        expect(other.status).toBe("completed");
        expect(c.id).not.toBe(other.id);
        expect(j.days[a.day].completed).toEqual([]);
    });
    it("pauses without counting paused time, resumes across reload and caps expiry without completing", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "calculation", time);
        a.runningSince = time;
        pauseAttempt(a, time + 60000);
        expect(a.elapsedMs).toBe(60000);
        expect(studyElapsed(a, time + 900000)).toBe(60000);
        a.runningSince = time + 900000;
        const restored = JSON.parse(JSON.stringify(j));
        settleJournal(restored, time + 4000000);
        expect(restored.attempts[0].elapsedMs).toBe(1800000);
        expect(restored.days["2026-10-24"].completed).toEqual([]);
        expect(restored.attempts[0].runningSince).toBeNull();
    });
    it("manual completion is idempotent and jumps around skipped blocks", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "opening", time);
        completeStudyStep(j, a.day, a.id, time + 1);
        completeStudyStep(j, a.day, a.id, time + 2);
        expect(j.attempts).toHaveLength(1);
        expect(nextStudyStep(plan.steps, j.days[a.day].completed, "opening")?.id).toBe(
            "calculation",
        );
    });
    it("freezes plan content and retains a separate explicit second attempt", () => {
        const j = setup();
        const a = selectStudyStep(j, "2026-10-24", "calculation", time);
        a.notes = "first work";
        a.status = "partial";
        const b = selectStudyStep(j, a.day, a.stepId, time + 2, true);
        expect(b.id).not.toBe(a.id);
        expect(a.notes).toBe("first work");
        const changed = structuredClone(plan);
        changed.steps[0].title = "Changed";
        ensureStudyDay(j, changed, a.day, 90);
        expect(j.days[a.day].plan.steps[0].title).toBe("Calculation");
    });
    it("uses London midnight and the 25-hour clock-change day", () => {
        expect(new Date(studyDayEnd("2026-10-24")).toISOString()).toBe("2026-10-24T23:00:00.000Z");
        expect(new Date(studyDayEnd("2026-10-25")).toISOString()).toBe("2026-10-26T00:00:00.000Z");
        const j = setup();
        const a = selectStudyStep(
            j,
            "2026-10-24",
            "calculation",
            Date.parse("2026-10-24T22:59:00Z"),
        );
        a.runningSince = Date.parse("2026-10-24T22:59:00Z");
        settleJournal(j, Date.parse("2026-10-25T01:00:00Z"));
        expect(a.elapsedMs).toBe(60000);
        expect(a.status).toBe("partial");
    });
    it("imports historical checks and notes exactly once with unknown time", () => {
        localStorage.clear();
        localStorage.setItem(
            "daily-study:test:2026-10-02",
            JSON.stringify({
                completed: ["calculation"],
                notes: { calculation: "Try the quiet move" },
            }),
        );
        const j = setup();
        importLegacyStudy(j, plan, localStorage);
        importLegacyStudy(j, plan, localStorage);
        expect(j.attempts).toHaveLength(1);
        expect(j.attempts[0]).toMatchObject({
            notes: "Try the quiet move",
            elapsedMs: 0,
            createdAt: null,
            legacyCompleted: true,
        });
        expect(localStorage.getItem("daily-study:test:2026-10-02")).toContain("Try the quiet move");
    });
    it("refuses corrupt legacy history instead of silently replacing it", () => {
        localStorage.clear();
        localStorage.setItem("daily-study:test:2026-10-02", "bad");
        expect(() => importLegacyStudy(setup(), plan, localStorage)).toThrow();
        localStorage.clear();
    });
    it("extracts exact exercise FEN/source and rejects illegal positions", () => {
        const choices = exerciseChoices(
            '[Event "Exercise 7"]\n[Source "https://lichess.org/study/example/chapter"]\n[FEN "8/8/8/8/8/6k1/8/K7 w - - 0 1"]\n\n*',
            "exercise.pgn",
        );
        expect(choices[0]).toMatchObject({
            reference: "Exercise 7",
            source: { path: "exercise.pgn", game: 0 },
        });
        expect(validStudyFen(choices[0].fen)).toBe(true);
        expect(validStudyFen("8/8/8/8/8/8/8/8 w - - 0 1")).toBe(false);
    });
    it("defines inclusive month and rolling periods across boundaries", () => {
        expect(studyHistoryRange("month", "2026-10-24")).toEqual({
            from: "2026-10-01",
            to: "2026-10-24",
        });
        expect(studyHistoryRange("week", "2026-11-02")).toEqual({
            from: "2026-10-27",
            to: "2026-11-02",
        });
    });
    it("abstains without enough logged evidence and makes bounded balancing adjustments", () => {
        const j = emptyJournal(plan.id);
        expect(proposeStudyAdjustment(plan, j, "2026-10-24").changed).toBe(false);
        for (const day of ["2026-10-21", "2026-10-22", "2026-10-23"]) {
            ensureStudyDay(j, plan, day, 60);
            const a = selectStudyStep(j, day, "calculation", Date.parse(`${day}T12:00Z`));
            a.elapsedMs = 1800000;
            a.status = "completed";
        }
        const r = proposeStudyAdjustment(plan, j, "2026-10-24");
        expect(r.changed).toBe(true);
        expect(r.plan.steps.map((s) => s.minutes60)).toEqual([25, 35]);
        expect(plan.steps[0].minutes60).toBe(30);
    });
    it("enforces weekly endgame cap without counting the two mode options twice", () => {
        const p = structuredClone(plan);
        p.steps[1].id = "endgames";
        p.priorities = {
            daily: [],
            perSession: [],
            adaptive: ["calculation"],
            weeklyCaps: { endgames: 2 },
        };
        const j = emptyJournal(p.id);
        ensureStudyDay(j, p, "2026-10-19", 60);
        ensureStudyDay(j, p, "2026-10-21", 90);
        const r = planForStudyDay(p, "2026-10-24", j);
        expect(r.steps[1].minutes60).toBe(0);
        expect(r.steps[0].minutes90).toBe(90);
    });
});
