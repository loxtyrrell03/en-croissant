import { describe, expect, it } from "vitest";
import {
    beginAiCoachBackgroundJob,
    finishAiCoachBackgroundJob,
    hasActiveAiCoachBackgroundJob,
    requestExitAfterAiCoach,
} from "../aiCoachBackground";

describe("native AI coach background jobs", () => {
    it("defers app exit until every active coach job has finished", () => {
        beginAiCoachBackgroundJob("coach-one");
        beginAiCoachBackgroundJob("coach-two");

        expect(hasActiveAiCoachBackgroundJob()).toBe(true);
        expect(requestExitAfterAiCoach()).toBe(true);
        expect(finishAiCoachBackgroundJob("coach-one")).toBe(false);
        expect(finishAiCoachBackgroundJob("coach-two")).toBe(true);
        expect(hasActiveAiCoachBackgroundJob()).toBe(false);
        expect(requestExitAfterAiCoach()).toBe(false);
    });
});
