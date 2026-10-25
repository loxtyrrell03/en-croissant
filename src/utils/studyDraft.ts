import { z } from "zod";
import { studyWorkSchema, type StudyAttempt } from "./studySession";
const draftSchema = z.object({
    notes: z.string(),
    work: z.array(studyWorkSchema),
    manualMinutes: z.number().min(0).max(1440).nullable(),
    annotationSaved: z.boolean(),
    reviewedPatterns: z.number().int().nonnegative().nullable().optional(),
    newPatterns: z.number().int().nonnegative().nullable().optional(),
    reviewManageable: z.boolean().optional(),
});
export const studyDraftKey = (id: string) => `study-draft:${id}`;
export const pendingStudyDrafts = new Map<string, z.infer<typeof draftSchema>>();
export const studyDraftErrors = new Map<string, string>();
export function studyDraft(attempt: StudyAttempt) {
    const pending = pendingStudyDrafts.get(attempt.id);
    if (pending) return pending;
    const raw = localStorage.getItem(studyDraftKey(attempt.id));
    if (raw)
        try {
            return draftSchema.parse(JSON.parse(raw));
        } catch {
            studyDraftErrors.set(
                attempt.id,
                "A recovery draft could not be read. The saved record is shown; the original draft is retained until you edit and save a replacement.",
            );
        }
    return {
        notes: attempt.notes,
        work: attempt.work,
        manualMinutes: attempt.manualMinutes,
        annotationSaved: attempt.annotationSaved,
        reviewedPatterns: attempt.reviewedPatterns,
        newPatterns: attempt.newPatterns,
        reviewManageable: attempt.reviewManageable,
    };
}
export function applyStudyDraft(attempt: StudyAttempt) {
    const draft = studyDraft(attempt);
    if (studyDraftErrors.has(attempt.id) && !pendingStudyDrafts.has(attempt.id))
        throw new Error(studyDraftErrors.get(attempt.id));
    Object.assign(attempt, draft);
}
