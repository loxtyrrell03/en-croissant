import { isTauri } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { type DailyStudyPlan, dailyStudyPlanSchema, openingFocus } from "./dailyStudyPlan";
import {
    emptyJournal,
    ensureStudyDay,
    settleJournal,
    studyJournalSchema,
    type StudyJournal,
} from "./studySession";
import { z } from "zod";
import { planForStudyDay } from "./studyPlanning";

// Same safe filename encoding as the automation CLI. Personal data never belongs in Git.
export function studyFileId(id: string) {
    return Array.from(new TextEncoder().encode(id), (n) => n.toString(16).padStart(2, "0")).join(
        "",
    );
}
export const studyBrowserKey = (id: string) => `daily-study-journal:${id}`;
export async function studyDirectory(root: string) {
    return resolve(root, "Study history");
}
export async function studyJournalPath(root: string, id: string) {
    return resolve(await studyDirectory(root), `journal-${studyFileId(id)}.json`);
}
export async function loadStudyJournal(root: string, id: string): Promise<StudyJournal> {
    const path = await studyJournalPath(root, id);
    const raw = isTauri()
        ? (await exists(path))
            ? await readTextFile(path)
            : null
        : localStorage.getItem(studyBrowserKey(id));
    if (raw === null) return emptyJournal(id);
    const journal = studyJournalSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, "")));
    if (journal.planId !== id) throw new Error("Study history belongs to a different plan.");
    return journal;
}
export async function writeStudyJournal(
    root: string,
    next: StudyJournal,
    expectedRevision: number,
) {
    const write = async () => {
        const current = await loadStudyJournal(root, next.planId);
        if (current.revision !== expectedRevision)
            throw new Error(
                "Study history changed in another window. Reload history before trying again.",
            );
        const value = studyJournalSchema.parse({ ...next, revision: expectedRevision + 1 });
        const raw = `${JSON.stringify(value, null, 2)}\n`;
        if (isTauri()) {
            const directory = await studyDirectory(root);
            if (!(await exists(directory))) await mkdir(directory, { recursive: true });
            const path = await studyJournalPath(root, next.planId);
            const temporary = `${path}.${crypto.randomUUID()}.tmp`;
            await writeTextFile(temporary, raw);
            await rename(temporary, path); // Same-directory atomic replacement preserves the old file on failure.
            if ((await readTextFile(path)) !== raw)
                throw new Error(
                    "Study history readback did not match. Reload history before continuing.",
                );
        } else localStorage.setItem(studyBrowserKey(next.planId), raw);
        return value;
    };
    if (navigator.locks)
        return navigator.locks.request(`study-journal:${root}:${next.planId}`, write);
    if (isTauri())
        throw new Error(
            "Safe study-history locking is unavailable. Restart with a supported WebView before recording study.",
        );
    return write(); // Isolated browser preview/tests; native always requires the shared lock.
}
/** One-time migration, preserving original keys and explicitly unknown timing. */
export function importLegacyStudy(journal: StudyJournal, plan: DailyStudyPlan, storage: Storage) {
    if (journal.legacyImported) return;
    const prefix = `daily-study:${plan.id}:`;
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)!;
        if (!key.startsWith(prefix)) continue;
        const day = key.slice(prefix.length);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const value = z
            .object({ completed: z.array(z.string()), notes: z.record(z.string()).default({}) })
            .parse(JSON.parse(storage.getItem(key)!));
        const state = ensureStudyDay(journal, plan, day, plan.defaultMinutes);
        state.completed = [...new Set([...state.completed, ...value.completed])];
        state.notes = { ...value.notes, ...state.notes };
        for (const step of plan.steps) {
            if (!value.completed.includes(step.id) && !value.notes[step.id]) continue;
            journal.attempts.push({
                id: `legacy:${day}:${step.id}`,
                day,
                sessionId: state.sessionId,
                stepId: step.id,
                title: step.title,
                topic:
                    step.id === "opening"
                        ? (openingFocus(plan, day)?.topic ?? step.title)
                        : step.title,
                createdAt: null,
                updatedAt: null,
                completedAt: null,
                mode: plan.defaultMinutes,
                plannedMs: 0,
                limitMs: 0,
                elapsedMs: 0,
                runningSince: null,
                status: "legacy",
                notes: value.notes[step.id] ?? "",
                work: [],
                resources: [],
                manualMinutes: null,
                annotationSaved: false,
                legacyCompleted: value.completed.includes(step.id),
            });
        }
    }
    journal.legacyImported = true;
}
export const studyAdaptationSchema = z.object({
    schemaVersion: z.literal(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    planId: z.string(),
    journalRevision: z.number().int().nonnegative(),
    createdAt: z.string(),
    reason: z.string().min(1),
    basePlan: dailyStudyPlanSchema,
    plan: dailyStudyPlanSchema,
    tacticsAdvice: z.string().optional(),
});
export type StudyAdaptation = z.infer<typeof studyAdaptationSchema>;
export async function loadStudyAdaptation(root: string, plan: DailyStudyPlan, day: string) {
    const name = `adaptation-${studyFileId(plan.id)}-${day}.json`;
    const path = await resolve(await studyDirectory(root), name);
    const raw = isTauri()
        ? (await exists(path))
            ? await readTextFile(path)
            : null
        : localStorage.getItem(name);
    if (!raw) return null;
    const value = studyAdaptationSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, "")));
    if (
        value.date !== day ||
        value.planId !== plan.id ||
        value.plan.id !== plan.id ||
        JSON.stringify(value.basePlan) !== JSON.stringify(plan)
    )
        throw new Error(
            "Today's adjustment is based on a different plan. The standard plan is available.",
        );
    const journal = await loadStudyJournal(root, plan.id);
    if (!journal.days[day] && value.journalRevision !== journal.revision)
        throw new Error(
            "Study history changed after today's adjustment. The standard plan is available.",
        );
    const scheduled = planForStudyDay(plan, day, journal);
    const strip = (p: DailyStudyPlan) => ({
        ...p,
        steps: p.steps.map(({ minutes60: _a, minutes90: _b, ...step }) => step),
    });
    if (JSON.stringify(strip(value.plan)) !== JSON.stringify(strip(plan)))
        throw new Error("Today's adjustment changed study content unexpectedly.");
    for (const step of value.plan.steps) {
        const original = scheduled.steps.find((s) => s.id === step.id)!;
        if (
            Math.abs(step.minutes60 - original.minutes60) > 5 ||
            Math.abs(step.minutes90 - original.minutes90) > 5
        )
            throw new Error("Today's adjustment exceeds the five-minute limit.");
    }
    return value;
}
export async function initialiseStudyJournal(root: string, plan: DailyStudyPlan, now: number) {
    const value = await loadStudyJournal(root, plan.id);
    const next = structuredClone(value);
    importLegacyStudy(next, plan, localStorage);
    settleJournal(next, now);
    return JSON.stringify(value) === JSON.stringify(next)
        ? value
        : writeStudyJournal(root, next, value.revision);
}
export async function readStudyExternal(root: string, courseId: string) {
    if (!isTauri()) return null;
    const directory = await resolve(await studyDirectory(root), "Chessable");
    if (!(await exists(directory))) return null;
    const accountPath = await resolve(directory, "account.txt");
    if (!(await exists(accountPath))) return null;
    const account = (await readTextFile(accountPath)).trim();
    const names = (await readDir(directory))
        .map((e) => e.name)
        .filter((n) => /^\d{4}-.*\.json$/.test(n))
        .sort();
    if (!names.length) return null;
    const schema = z.object({
        schemaVersion: z.literal(1),
        source: z.literal("https://www.chessable.com/"),
        method: z.literal("rendered-dashboard"),
        account: z.string().min(1),
        capturedAt: z.string().datetime(),
        courses: z.array(
            z.object({
                courseId: z.string(),
                dueReviews: z.number().int().nonnegative().nullable(),
            }),
        ),
    });
    const snapshot = schema.parse(
        JSON.parse(await readTextFile(await resolve(directory, names[names.length - 1]))),
    );
    if (snapshot.account !== account) throw new Error("Chessable snapshot account mismatch.");
    const age = Date.now() - Date.parse(snapshot.capturedAt);
    return {
        capturedAt: snapshot.capturedAt,
        fresh: age >= 0 && age < 36 * 3600000,
        due: snapshot.courses.find((c) => c.courseId === courseId)?.dueReviews ?? null,
    };
}
