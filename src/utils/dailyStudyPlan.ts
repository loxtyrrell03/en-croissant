import { z } from "zod";

export const studyResourceSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("web"),
        id: z.string().min(1),
        title: z.string().min(1),
        url: z.string().url(),
        linked: z.boolean().default(true),
    }),
    z.object({
        kind: z.literal("pgn"),
        id: z.string().min(1),
        title: z.string().min(1),
        path: z.string().min(1),
    }),
]);
export const dailyStudyPlanSchema = z
    .object({
        schemaVersion: z.literal(1),
        id: z.string().min(1),
        title: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        defaultMinutes: z.union([z.literal(60), z.literal(90)]).default(90),
        steps: z
            .array(
                z.object({
                    id: z.string().min(1),
                    title: z.string().min(1),
                    minutes60: z.number().int().min(0).max(60),
                    minutes90: z.number().int().min(0).max(90),
                    instructions: z.string().min(1),
                    summary: z.string().optional(),
                    resources: z.array(studyResourceSchema).default([]),
                }),
            )
            .min(1)
            .max(12),
        openingWeeks: z
            .array(
                z.object({
                    first: z.number().int().positive(),
                    last: z.number().int().positive(),
                    topic: z.string(),
                    instructions: z.string(),
                }),
            )
            .default([]),
        dayAllocations: z
            .array(
                z.object({
                    weekday: z.number().int().min(0).max(6),
                    steps: z.array(
                        z.object({
                            id: z.string(),
                            minutes60: z.number().int().min(0).max(60),
                            minutes90: z.number().int().min(0).max(90),
                        }),
                    ),
                }),
            )
            .optional(),
        priorities: z
            .object({
                daily: z.array(z.string()),
                perSession: z.array(z.string()).default([]),
                adaptive: z.array(z.string()),
                weeklyCaps: z.record(z.number().int().min(0).max(7)),
            })
            .optional(),
    })
    .superRefine((plan, context) => {
        if (plan.dayAllocations) {
            if (
                plan.dayAllocations.length !== 7 ||
                new Set(plan.dayAllocations.map((d) => d.weekday)).size !== 7
            )
                context.addIssue({ code: "custom", message: "Provide each weekday once" });
            for (const day of plan.dayAllocations) {
                if (
                    day.steps.length !== plan.steps.length ||
                    new Set(day.steps.map((s) => s.id)).size !== plan.steps.length ||
                    day.steps.some((s) => !plan.steps.some((p) => p.id === s.id)) ||
                    day.steps.reduce((n, s) => n + s.minutes60, 0) !== 60 ||
                    day.steps.reduce((n, s) => n + s.minutes90, 0) !== 90
                )
                    context.addIssue({
                        code: "custom",
                        message: "Each weekday must preserve step IDs and 60/90 totals",
                    });
            }
        }
        if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length)
            context.addIssue({ code: "custom", message: "Study step IDs must be unique" });
        for (const minutes of [60, 90] as const) {
            if (
                plan.steps.reduce(
                    (total, step) => total + step[minutes === 60 ? "minutes60" : "minutes90"],
                    0,
                ) !== minutes
            )
                context.addIssue({
                    code: "custom",
                    message: `${minutes}-minute plan must total ${minutes} minutes`,
                });
        }
        for (const step of plan.steps)
            for (const resource of step.resources) {
                if (resource.kind === "web" && !isStudyUrl(resource.url))
                    context.addIssue({
                        code: "custom",
                        message: "Use an HTTPS Chessable, Lichess or Chess.com link",
                    });
            }
    });
export type DailyStudyPlan = z.infer<typeof dailyStudyPlanSchema>;
export type StudyStep = DailyStudyPlan["steps"][number];
export type StudyResource = z.infer<typeof studyResourceSchema>;
export type StudyProgress = { completed: string[]; notes: Record<string, string> };

export function isStudyUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            [
                "chessable.com",
                "www.chessable.com",
                "lichess.org",
                "www.chess.com",
                "chess.com",
            ].includes(url.hostname)
        );
    } catch {
        return false;
    }
}
export function getStudyDateKey(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}
export function studyProgressKey(planId: string, day: string) {
    return `daily-study:${planId}:${day}`;
}
export function readStudyProgress(
    storage: Pick<Storage, "getItem">,
    planId: string,
    day: string,
): StudyProgress {
    try {
        const raw = JSON.parse(storage.getItem(studyProgressKey(planId, day)) ?? "{}");
        return {
            completed: Array.isArray(raw.completed)
                ? raw.completed.filter((id: unknown) => typeof id === "string")
                : [],
            notes: z.record(z.string()).parse(raw.notes ?? {}),
        };
    } catch {
        return { completed: [], notes: {} };
    }
}
export function openingFocus(plan: DailyStudyPlan, day: string) {
    const days = Math.floor(
        (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${plan.startDate}T12:00:00Z`)) / 86400000,
    );
    const week = Math.max(1, Math.floor(days / 7) + 1);
    return (
        plan.openingWeeks.find((topic) => week >= topic.first && week <= topic.last) ??
        plan.openingWeeks.at(-1)
    );
}
