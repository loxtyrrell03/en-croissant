import { describe, expect, it } from "vitest";
import {
    dailyStudyPlanSchema,
    getStudyDateKey,
    isStudyUrl,
    openingFocus,
    readStudyProgress,
    studyProgressKey,
} from "../dailyStudyPlan";

const plan = {
    schemaVersion: 1,
    id: "test",
    title: "Study",
    startDate: "2026-10-06",
    defaultMinutes: 90,
    steps: [
        {
            id: "one",
            title: "Calculation",
            minutes60: 60,
            minutes90: 90,
            instructions: "Calculate",
            resources: [],
        },
    ],
    openingWeeks: [
        { first: 1, last: 2, topic: "Pawn recovery", instructions: "Keep tension" },
        { first: 3, last: 6, topic: "Central breaks", instructions: "Check replies" },
    ],
};

describe("daily study plan", () => {
    it("rejects inconsistent time budgets and duplicate step IDs", () => {
        expect(dailyStudyPlanSchema.safeParse(plan).success).toBe(true);
        expect(
            dailyStudyPlanSchema.safeParse({
                ...plan,
                steps: [{ ...plan.steps[0], minutes60: 59 }],
            }).success,
        ).toBe(false);
        expect(
            dailyStudyPlanSchema.safeParse({
                ...plan,
                steps: [
                    { ...plan.steps[0], minutes60: 30, minutes90: 45 },
                    { ...plan.steps[0], minutes60: 30, minutes90: 45 },
                ],
            }).success,
        ).toBe(false);
    });
    it("uses the London day across UTC and daylight-saving boundaries", () => {
        expect(getStudyDateKey(new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
        expect(getStudyDateKey(new Date("2026-10-26T23:30:00Z"))).toBe("2026-10-26");
    });
    it("preserves independent daily notes and completion without borrowing another day's work", () => {
        const storage = {
            getItem: (key: string) =>
                key === studyProgressKey("test", "2026-10-06")
                    ? JSON.stringify({
                          completed: ["one"],
                          notes: { one: "Missed the strongest reply" },
                      })
                    : null,
        };
        expect(readStudyProgress(storage, "test", "2026-10-06").completed).toEqual(["one"]);
        expect(readStudyProgress(storage, "test", "2026-10-07")).toEqual({
            completed: [],
            notes: {},
        });
        expect(readStudyProgress({ getItem: () => "invalid" }, "test", "2026-10-06")).toEqual({
            completed: [],
            notes: {},
        });
    });
    it("rejects lookalike domains, credentials, local files and insecure course links", () => {
        expect(isStudyUrl("https://www.chessable.com/course/123/")).toBe(true);
        for (const url of [
            "http://www.chessable.com/",
            "https://www.chessable.com.evil.test/",
            "https://user:secret@www.chessable.com/",
            "file:///C:/private.txt",
            "https://example.com/",
            "https://www.chessable.com:8443/",
        ])
            expect(isStudyUrl(url)).toBe(false);
    });
    it("holds each opening topic for its scheduled weeks", () => {
        const validated = dailyStudyPlanSchema.parse(plan);
        expect(openingFocus(validated, "2026-10-19")?.topic).toBe("Pawn recovery");
        expect(openingFocus(validated, "2026-10-20")?.topic).toBe("Central breaks");
    });
});
