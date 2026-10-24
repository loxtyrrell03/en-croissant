import { expect, test } from "vitest";
import {
    DEFAULT_GAME_REPORT_SETTINGS,
    gameAnalysisPreset,
    gameReportLimitLabel,
    nativeGameReportLimits,
    normalizeGameReportSettings,
    presetGameReportLimit,
    validGameReportLimit,
} from "../gameAnalysisSettings";

test("fresh reports use Medium and each preset sends both independent bounds", () => {
    expect(normalizeGameReportSettings(undefined)).toEqual(DEFAULT_GAME_REPORT_SETTINGS);
    for (const [preset, depth, timeMs] of [
        ["low", 8, 50],
        ["medium", 16, 250],
        ["high", 22, 1000],
    ] as const) {
        const limit = presetGameReportLimit(preset);
        expect(gameAnalysisPreset(limit)).toBe(preset);
        expect(nativeGameReportLimits(limit)).toEqual({
            goMode: { t: "Time", c: timeMs },
            searchLimits: { depth, timeMs },
        });
    }
});
test.each(["Depth", "Time", "Nodes"] as const)(
    "saved %s-only settings keep their original units and value",
    (t) => {
        const old = {
            novelty: false,
            variations: false,
            reversed: false,
            engine: "my-engine",
            goMode: { t, c: 500 },
        };
        expect(normalizeGameReportSettings(old)).toEqual(old);
        expect(nativeGameReportLimits(old.goMode)).toEqual({ goMode: old.goMode });
        expect(gameAnalysisPreset(old.goMode)).toBe("custom");
        expect(old.goMode).toEqual({ t, c: 500 });
    },
);
test("malformed limits cannot become an unbounded native request", () => {
    for (const value of [
        { t: "Infinite" },
        { t: "Combined", c: { depth: 1, timeMs: 50 } },
        { t: "Combined", c: { depth: 8, timeMs: 49 } },
        { t: "Depth", c: NaN },
        { t: "Nodes", c: -1 },
    ]) {
        expect(validGameReportLimit(value)).toBe(false);
        expect(normalizeGameReportSettings({ goMode: value }).goMode).toEqual(
            DEFAULT_GAME_REPORT_SETTINGS.goMode,
        );
    }
    expect(gameReportLimitLabel(presetGameReportLimit("low"))).toBe(
        "Depth 8 · up to 0.05 s per position",
    );
});
