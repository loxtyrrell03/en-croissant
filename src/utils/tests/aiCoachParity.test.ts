import { describe, expect, test } from "vitest";
import {
    fromNativeAiCoachScope,
    getDefaultAiCoachQuestion,
    getDefaultAiCoachScope,
    toNativeAiCoachScope,
} from "@/utils/aiCoachParity";

describe("AI Coach cross-surface parity", () => {
    test("uses the same default scope for phone and native coach surfaces", () => {
        expect(getDefaultAiCoachScope(true, 0)).toBe("whole-game");
        expect(getDefaultAiCoachScope(false, 5)).toBe("whole-game");
        expect(getDefaultAiCoachScope(false, 4)).toBe("position");
    });

    test("uses the phone coach questions and maps scopes losslessly", () => {
        expect(getDefaultAiCoachQuestion("whole-game")).toContain("which book lessons");
        expect(getDefaultAiCoachQuestion("position")).toContain("most relevant lesson");
        expect(toNativeAiCoachScope("whole-game")).toBe("whole_game");
        expect(toNativeAiCoachScope("position")).toBe("current_line");
        expect(fromNativeAiCoachScope("whole_game")).toBe("whole-game");
        expect(fromNativeAiCoachScope("current_line")).toBe("position");
    });
});
