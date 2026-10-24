import type { GameAnalysisLimits, GoMode } from "@/bindings";

export const GAME_ANALYSIS_PRESETS = {
    low: { label: "Low", depth: 8, timeMs: 50 },
    medium: { label: "Medium", depth: 16, timeMs: 250 },
    high: { label: "High", depth: 22, timeMs: 1000 },
} as const;
export type GameAnalysisPreset = keyof typeof GAME_ANALYSIS_PRESETS | "custom";
export type GameReportLimit =
    | Exclude<GoMode, { t: "Infinite" | "PlayersTime" }>
    | { t: "Combined"; c: { depth: number; timeMs: number } };
export type GameReportSettings = {
    novelty: boolean;
    reversed: boolean;
    variations: boolean;
    goMode: GameReportLimit;
    engine: string;
};
export const DEFAULT_GAME_REPORT_SETTINGS: GameReportSettings = {
    novelty: true,
    reversed: true,
    variations: true,
    engine: "",
    goMode: { t: "Combined", c: { depth: 16, timeMs: 250 } },
};
const integer = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export function validGameReportLimit(value: unknown): value is GameReportLimit {
    if (!value || typeof value !== "object") return false;
    const mode = value as { t?: string; c?: unknown };
    if (mode.t === "Combined") {
        const limits = mode.c as Record<string, unknown> | null;
        return !!limits && integer(limits.depth, 2, 30) && integer(limits.timeMs, 50, 5000);
    }
    return ["Depth", "Time", "Nodes"].includes(mode.t ?? "") && integer(mode.c, 1, 0xffff_ffff);
}
export function normalizeGameReportSettings(value: unknown): GameReportSettings {
    const saved = value && typeof value === "object" ? (value as Partial<GameReportSettings>) : {};
    return {
        novelty: typeof saved.novelty === "boolean" ? saved.novelty : true,
        reversed: typeof saved.reversed === "boolean" ? saved.reversed : true,
        variations: typeof saved.variations === "boolean" ? saved.variations : true,
        engine: typeof saved.engine === "string" ? saved.engine : "",
        // An existing single Depth/Time/Nodes preference keeps its meaning.
        goMode: validGameReportLimit(saved.goMode)
            ? saved.goMode
            : DEFAULT_GAME_REPORT_SETTINGS.goMode,
    };
}
export function gameAnalysisPreset(limit: GameReportLimit): GameAnalysisPreset {
    return limit.t === "Combined"
        ? ((Object.keys(GAME_ANALYSIS_PRESETS) as (keyof typeof GAME_ANALYSIS_PRESETS)[]).find(
              (key) =>
                  GAME_ANALYSIS_PRESETS[key].depth === limit.c.depth &&
                  GAME_ANALYSIS_PRESETS[key].timeMs === limit.c.timeMs,
          ) ?? "custom")
        : "custom";
}
export function presetGameReportLimit(
    preset: Exclude<GameAnalysisPreset, "custom">,
): GameReportLimit {
    const { depth, timeMs } = GAME_ANALYSIS_PRESETS[preset];
    return { t: "Combined", c: { depth, timeMs } };
}
export function nativeGameReportLimits(limit: GameReportLimit): {
    goMode: GoMode;
    searchLimits?: GameAnalysisLimits;
} {
    if (!validGameReportLimit(limit)) throw new Error("Choose valid game-analysis limits.");
    return limit.t === "Combined"
        ? { goMode: { t: "Time", c: limit.c.timeMs }, searchLimits: { ...limit.c } }
        : { goMode: limit };
}
export function gameReportLimitLabel(limit: GameReportLimit): string {
    switch (limit.t) {
        case "Combined":
            return `Depth ${limit.c.depth} · up to ${limit.c.timeMs / 1000} s per position`;
        case "Depth":
            return `Depth ${limit.c} per position`;
        case "Time":
            return `Up to ${limit.c / 1000} s per position`;
        case "Nodes":
            return `${limit.c.toLocaleString()} nodes per position`;
    }
}
