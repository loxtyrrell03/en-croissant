import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyStudyPlan } from "./dailyStudyPlan";
import { initialiseStudyJournal, writeStudyJournal } from "./studyJournal";
import { type StudyJournal, settleJournal } from "./studySession";
import { pendingStudyDrafts } from "./studyDraft";

export function useStudyJournal(root: string, plan: DailyStudyPlan | null) {
    const [journal, setJournal] = useState<StudyJournal | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const value = useRef<StudyJournal | null>(null);
    const writing = useRef(false);
    const generation = useRef(0);
    const currentPlan = useRef(plan);
    currentPlan.current = plan;
    const planId = plan?.id;
    const reload = useCallback(async () => {
        const request = ++generation.current;
        const plan = currentPlan.current;
        if (plan?.id !== planId) return;
        if (!plan || !root) return;
        setBusy(true);
        try {
            const next = await initialiseStudyJournal(root, plan, Date.now());
            if (request !== generation.current) return;
            value.current = next;
            setJournal(next);
            setError("");
        } catch (e) {
            if (request === generation.current)
                setError(
                    `Study history could not be loaded. ${e instanceof Error ? e.message : "Please retry."}`,
                );
        } finally {
            if (request === generation.current) setBusy(false);
        }
    }, [root, planId]);
    const invalidate = useCallback(() => {
        generation.current++;
    }, []);
    useEffect(() => {
        value.current = null;
        setJournal(null);
        void reload();
        return invalidate;
    }, [reload, invalidate]);
    const update = useCallback(
        async (change: (next: StudyJournal) => void) => {
            if (!value.current || writing.current) return null;
            writing.current = true;
            setBusy(true);
            const request = generation.current;
            try {
                const next = structuredClone(value.current);
                settleJournal(next, Date.now());
                change(next);
                const saved = await writeStudyJournal(root, next, value.current.revision);
                if (request !== generation.current) return null;
                value.current = saved;
                setJournal(saved);
                setError("");
                // Retain only unsaved/newer recovery drafts; never replay an old draft over a later correction.
                for (const attempt of saved.attempts) {
                    const key = `study-draft:${attempt.id}`;
                    const raw = localStorage.getItem(key);
                    const pending = pendingStudyDrafts.get(attempt.id);
                    if (!raw && !pending) continue;
                    try {
                        const draft = pending ?? JSON.parse(raw!);
                        if (
                            Object.entries(draft).every(
                                ([k, v]) =>
                                    JSON.stringify(v) ===
                                    JSON.stringify(attempt[k as keyof typeof attempt]),
                            )
                        ) {
                            localStorage.removeItem(key);
                            pendingStudyDrafts.delete(attempt.id);
                        }
                    } catch {
                        /* A malformed recovery draft is preserved for explicit recovery. */
                    }
                }
                return saved;
            } catch (e) {
                if (request === generation.current)
                    setError(
                        `Study changes were not saved. ${e instanceof Error ? e.message : "Please retry."}`,
                    );
                return null;
            } finally {
                writing.current = false;
                if (request === generation.current) setBusy(false);
            }
        },
        [root],
    );
    return { journal, busy, error, reload, update };
}
