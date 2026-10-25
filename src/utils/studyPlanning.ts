import { type DailyStudyPlan, dailyStudyPlanSchema } from "./dailyStudyPlan";
import { type StudyJournal, studyElapsed } from "./studySession";

export function studyWeekStart(day: string) {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
}
export function tacticsStudyAdvice(journal: StudyJournal, day: string, due?: number | null) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const recent = journal.attempts.filter(
        (a) =>
            a.stepId === "patterns" &&
            a.day < day &&
            a.day >=
                new Date(Date.parse(`${day}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10),
    );
    const reviewedDays = new Set(
        recent.filter((a) => (a.reviewedPatterns ?? 0) > 0 && a.reviewManageable).map((a) => a.day),
    );
    if (![3, 6].includes(weekday))
        return "Review known tactical patterns today. New-pattern days are Wednesday and Saturday, after review.";
    if (due !== undefined && due !== null && due > 100)
        return `Review known patterns today: the latest Chessable snapshot has ${due} due. New patterns can wait; no catch-up debt is added.`;
    if (reviewedDays.size < 2)
        return "Review known patterns today. Once two recent review days are recorded as manageable, Wednesday/Saturday can include up to two unseen patterns after review.";
    return "Review known patterns first, then optionally try up to two unseen Woodpecker patterns if today's review remains manageable. Log review and first attempts separately.";
}
export function planForStudyDay(base: DailyStudyPlan, day: string, journal: StudyJournal) {
    const plan = structuredClone(base);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const allocations = base.dayAllocations?.find((d) => d.weekday === weekday);
    if (allocations)
        for (const step of plan.steps)
            Object.assign(
                step,
                allocations.steps.find((s) => s.id === step.id),
            );
    for (const [id, cap] of Object.entries(base.priorities?.weeklyCaps ?? {})) {
        const week = studyWeekStart(day);
        const sessions = [
            ...Object.entries(journal.days)
                .filter(([date]) => date !== day)
                .map(([date, state]) => ({ ...state, day: date })),
            ...journal.pastSessions,
        ];
        const used = new Set(
            sessions
                .filter(
                    (state) =>
                        state.day >= week &&
                        studyWeekStart(state.day) === week &&
                        (state.plan.steps.some(
                            (s) => s.id === id && (s.minutes60 > 0 || s.minutes90 > 0),
                        ) ||
                            state.completed.includes(id)),
                )
                .map((state) => state.sessionId),
        );
        if (used.size >= cap) {
            const step = plan.steps.find((s) => s.id === id);
            const recipient = plan.steps.find((s) => s.id === base.priorities?.adaptive[0]);
            if (step && recipient && step !== recipient) {
                recipient.minutes60 += step.minutes60;
                recipient.minutes90 += step.minutes90;
                step.minutes60 = 0;
                step.minutes90 = 0;
            }
        }
    }
    return dailyStudyPlanSchema.parse(plan);
}

/** Balance recorded activity, not learning ability or inferred missed work. No accumulated debt. */
export function proposeStudyAdjustment(base: DailyStudyPlan, journal: StudyJournal, day: string) {
    const plan = planForStudyDay(base, day, journal);
    const cutoff = new Date(`${day}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);
    const from = cutoff.toISOString().slice(0, 10);
    const attempts = journal.attempts.filter(
        (a) => a.day >= from && a.day < day && a.status !== "legacy",
    );
    const timed = (id: string) =>
        attempts
            .filter((a) => a.stepId === id)
            .reduce(
                (sum, a) => sum + studyElapsed(a, Date.now()) / 60000 + (a.manualMinutes ?? 0),
                0,
            );
    const days = new Set(
        attempts
            .filter((a) => studyElapsed(a, Date.now()) > 0 || (a.manualMinutes ?? 0) > 0)
            .map((a) => a.day),
    );
    const protectedIds = [
        ...(base.priorities?.daily ?? []),
        ...(base.priorities?.perSession ?? []),
    ];
    const eligible = plan.steps.filter(
        (s) =>
            base.priorities?.adaptive.includes(s.id) &&
            !protectedIds.includes(s.id) &&
            s.minutes60 > 5 &&
            s.minutes90 > 5,
    );
    const total = eligible.reduce((n, s) => n + timed(s.id), 0);
    if (days.size < 3 || total < 60 || eligible.length < 2)
        return {
            plan,
            changed: false,
            reason: "Keep the weekly plan: fewer than three days or 60 minutes of relevant recorded study in the last seven days.",
        };
    // Compare with the actual allocations on studied dates, rather than equal weights.
    const recordedSessions = new Set(
        attempts
            .filter((a) => studyElapsed(a, Date.now()) > 0 || (a.manualMinutes ?? 0) > 0)
            .map((a) => a.sessionId),
    );
    const sessions = [...Object.values(journal.days), ...journal.pastSessions].filter((s) =>
        recordedSessions.has(s.sessionId),
    );
    const expected = (id: string) =>
        sessions.reduce((sum, state) => {
            const step = state?.plan.steps.find((s) => s.id === id);
            return sum + (step ? step[state.mode === 60 ? "minutes60" : "minutes90"] : 0);
        }, 0);
    const planned = eligible.reduce((n, s) => n + expected(s.id), 0);
    if (!planned)
        return {
            plan,
            changed: false,
            reason: "Keep the weekly plan: planned balance is unavailable.",
        };
    const ranked = eligible
        .map((s) => ({ step: s, delta: timed(s.id) / total - expected(s.id) / planned }))
        .sort((a, b) => a.delta - b.delta);
    const recipient = ranked[0],
        donor = ranked[ranked.length - 1];
    if (recipient.delta > -0.1 || donor.delta < 0.15)
        return {
            plan,
            changed: false,
            reason: "Recent recorded study is reasonably balanced; keep the weekly plan.",
        };
    for (const field of ["minutes60", "minutes90"] as const) {
        recipient.step[field] += 5;
        donor.step[field] -= 5;
    }
    return {
        plan: dailyStudyPlanSchema.parse(plan),
        changed: true,
        reason: `Add 5 minutes to ${recipient.step.title} and take 5 from ${donor.step.title}. Across ${days.size} logged days, ${recipient.step.title} has less recorded time than its planned share. Unlogged work is unknown; no catch-up debt is added.`,
    };
}
