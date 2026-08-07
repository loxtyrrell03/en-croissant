import { describe, expect, test } from "vitest";
import {
    COACH_MODELS,
    DEFAULT_COACH_MODEL,
    getCoachModelDefinition,
    normalizeCoachReasoningEffort,
} from "@/utils/coachModels";

describe("Coach model selector", () => {
    test("contains the allowlisted Codex and Antigravity model families", () => {
        expect(COACH_MODELS.map((model) => model.id)).toEqual([
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gemini-3.1-pro",
            "gemini-3.5-flash",
            "gemini-3.6-flash",
        ]);
        expect(DEFAULT_COACH_MODEL).toBe("gpt-5.6-sol");
    });

    test("uses only reasoning levels exposed by each provider", () => {
        const pro = getCoachModelDefinition("gemini-3.1-pro");
        expect(pro.command).toBe("agy");
        expect(pro.reasoningEfforts).toEqual(["low", "high"]);
        expect(normalizeCoachReasoningEffort(pro, "medium")).toBe("high");

        const sol = getCoachModelDefinition("gpt-5.6-sol");
        expect(sol.command).toBe("codex");
        expect(normalizeCoachReasoningEffort(sol, "max")).toBe("max");
    });
});
