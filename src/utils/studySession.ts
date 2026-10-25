import { z } from "zod";
import {
    dailyStudyPlanSchema,
    getStudyDateKey,
    type DailyStudyPlan,
    type StudyStep,
} from "./dailyStudyPlan";

const timestamp = z.number().finite().nonnegative();
export const studyWorkSchema = z.object({
    id: z.string(),
    reference: z.string(),
    fen: z.string().optional(),
    work: z.string(),
    resourceId: z.string().optional(),
    source: z
        .object({
            path: z.string(),
            game: z.number().int().nonnegative(),
            url: z.string().optional(),
        })
        .optional(),
});
export const studyAttemptSchema = z.object({
    id: z.string(),
    day: z.string(),
    sessionId: z.string(),
    stepId: z.string(),
    title: z.string(),
    topic: z.string(),
    createdAt: timestamp.nullable(),
    updatedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
    mode: z.union([z.literal(60), z.literal(90)]),
    plannedMs: timestamp,
    limitMs: timestamp,
    elapsedMs: timestamp,
    // Timer position is separate from actual study time, so seeking never invents work.
    timerOffsetMs: z.number().finite().optional(),
    runningSince: timestamp.nullable(),
    status: z.enum(["paused", "completed", "partial", "legacy"]),
    notes: z.string(),
    work: z.array(studyWorkSchema),
    resources: z.array(
        z.object({ id: z.string(), title: z.string(), reference: z.string(), openedAt: timestamp }),
    ),
    manualMinutes: z.number().finite().min(0).max(1440).nullable(),
    legacyCompleted: z.boolean().optional(),
    annotationSaved: z.boolean().default(false),
    reviewedPatterns: z.number().int().nonnegative().nullable().optional(),
    newPatterns: z.number().int().nonnegative().nullable().optional(),
    reviewManageable: z.boolean().optional(),
    completionRevokedAt: timestamp.optional(),
});
export const studyDaySchema = z.object({
    sessionId: z.string(),
    sessionNumber: z.number().int().positive(),
    tacticsAdvice: z.string().optional(),
    plan: dailyStudyPlanSchema,
    mode: z.union([z.literal(60), z.literal(90)]),
    completed: z.array(z.string()),
    notes: z.record(z.string()),
    current: z.string().nullable(),
    adaptation: z.string().nullable(),
});
export const studyJournalSchema = z.object({
    schemaVersion: z.literal(1),
    planId: z.string(),
    revision: z.number().int().nonnegative(),
    days: z.record(studyDaySchema),
    pastSessions: z.array(studyDaySchema.extend({ day: z.string() })),
    attempts: z.array(studyAttemptSchema),
    legacyImported: z.boolean(),
    preferredMode: z.union([z.literal(60), z.literal(90)]).optional(),
});
export type StudyWork = z.infer<typeof studyWorkSchema>;
export type StudyAttempt = z.infer<typeof studyAttemptSchema>;
export type StudyDay = z.infer<typeof studyDaySchema>;
export type StudyJournal = z.infer<typeof studyJournalSchema>;
export const emptyJournal = (planId: string): StudyJournal => ({
    schemaVersion: 1,
    planId,
    revision: 0,
    days: {},
    pastSessions: [],
    attempts: [],
    legacyImported: false,
});
export const studyDuration = (step: StudyStep, minutes: 60 | 90) =>
    step[minutes === 60 ? "minutes60" : "minutes90"] * 60000;

/** First instant of the following London date, including 23/25-hour DST days. */
export function studyDayEnd(day: string) {
    let low = Date.parse(`${day}T00:00:00Z`) - 3600000;
    let high = low + 27 * 3600000;
    while (high - low > 1) {
        const mid = Math.floor((high + low) / 2);
        if (getStudyDateKey(new Date(mid)) <= day) low = mid;
        else high = mid;
    }
    return high;
}
export function studyElapsed(attempt: StudyAttempt, now: number) {
    return (
        attempt.elapsedMs +
        (attempt.runningSince === null
            ? 0
            : Math.min(
                  Math.max(0, attempt.limitMs - attempt.elapsedMs - (attempt.timerOffsetMs ?? 0)),
                  Math.max(0, Math.min(now, studyDayEnd(attempt.day)) - attempt.runningSince),
              ))
    );
}
export function studyTimerElapsed(attempt: StudyAttempt, now: number) {
    return Math.max(
        0,
        Math.min(attempt.limitMs, studyElapsed(attempt, now) + (attempt.timerOffsetMs ?? 0)),
    );
}
export function seekStudyTimer(attempt: StudyAttempt, positionMs: number, now: number) {
    if (attempt.status !== "paused" || !Number.isFinite(positionMs)) return;
    const wasRunning = attempt.runningSince !== null;
    pauseAttempt(attempt, now);
    const position = Math.max(0, Math.min(attempt.limitMs, positionMs));
    attempt.timerOffsetMs = position - attempt.elapsedMs;
    if (wasRunning && position < attempt.limitMs) attempt.runningSince = now;
}
export function pauseAttempt(attempt: StudyAttempt, now: number) {
    attempt.elapsedMs = studyElapsed(attempt, now);
    attempt.runningSince = null;
    attempt.updatedAt = now;
}
export function settleJournal(journal: StudyJournal, now: number) {
    const day = getStudyDateKey(new Date(now));
    for (const attempt of journal.attempts) {
        if (
            attempt.runningSince !== null &&
            (attempt.day !== day || studyTimerElapsed(attempt, now) >= attempt.limitMs)
        )
            pauseAttempt(attempt, Math.min(now, studyDayEnd(attempt.day)));
        if (attempt.day < day && attempt.status === "paused") attempt.status = "partial";
    }
}
export function ensureStudyDay(
    journal: StudyJournal,
    plan: DailyStudyPlan,
    day: string,
    mode: 60 | 90,
    adaptation: string | null = null,
) {
    return (journal.days[day] ??= {
        sessionId: crypto.randomUUID(),
        sessionNumber: 1,
        plan: structuredClone(plan),
        mode,
        completed: [],
        notes: {},
        current: null,
        adaptation,
    });
}
export function currentAttempt(journal: StudyJournal, day: string) {
    return journal.attempts.find((attempt) => attempt.id === journal.days[day]?.current);
}
export function selectStudyStep(
    journal: StudyJournal,
    day: string,
    stepId: string,
    now: number,
    fresh = false,
) {
    const state = journal.days[day];
    const step = state.plan.steps.find((item) => item.id === stepId)!;
    const current = currentAttempt(journal, day);
    if (current) pauseAttempt(current, now);
    let attempt = !fresh
        ? [...journal.attempts]
              .reverse()
              .find(
                  (item) =>
                      item.sessionId === state.sessionId &&
                      item.stepId === stepId &&
                      (item.status === "paused" || item.status === "partial"),
              )
        : undefined;
    if (!attempt) {
        attempt = {
            id: crypto.randomUUID(),
            day,
            sessionId: state.sessionId,
            stepId,
            title: step.title,
            topic: step.summary ?? step.title,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            mode: state.mode,
            plannedMs: studyDuration(step, state.mode),
            limitMs: studyDuration(step, state.mode),
            elapsedMs: 0,
            runningSince: null,
            status: "paused",
            notes: "",
            work: [],
            resources: [],
            manualMinutes: null,
            annotationSaved: false,
        };
        journal.attempts.push(attempt);
    }
    // Reopening a saved partial continues that attempt; only Restart creates another.
    attempt.status = "paused";
    state.current = attempt.id;
    return attempt;
}
export function restartStudyStep(journal: StudyJournal, day: string, stepId: string, now: number) {
    const state = journal.days[day];
    for (const attempt of journal.attempts) {
        if (
            attempt.sessionId === state.sessionId &&
            attempt.stepId === stepId &&
            attempt.status === "paused"
        ) {
            pauseAttempt(attempt, now);
            attempt.status = "partial";
        }
    }
    state.completed = state.completed.filter((id) => id !== stepId);
    return selectStudyStep(journal, day, stepId, now, true);
}
export function completeStudyStep(journal: StudyJournal, day: string, id: string, now: number) {
    const state = journal.days[day];
    const attempt = journal.attempts.find((item) => item.id === id && item.day === day);
    if (!attempt || attempt.status === "completed" || attempt.status === "legacy") return;
    pauseAttempt(attempt, now);
    attempt.status = "completed";
    attempt.completedAt = now;
    state.completed = [...new Set([...state.completed, attempt.stepId])];
    state.current = null;
}
export function nextStudyStep(steps: StudyStep[], completed: string[], after?: string) {
    const index = steps.findIndex((step) => step.id === after);
    return [...steps.slice(index + 1), ...steps.slice(0, index + 1)].find(
        (step) => !completed.includes(step.id),
    );
}
export function studyClock(ms: number) {
    const seconds = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function studyTotals(attempts: StudyAttempt[], now: number) {
    return {
        timedMs: attempts.reduce((sum, a) => sum + studyElapsed(a, now), 0),
        manualMinutes: attempts.reduce((sum, a) => sum + (a.manualMinutes ?? 0), 0),
        completed: attempts.filter((a) => a.status === "completed" || a.legacyCompleted).length,
    };
}
