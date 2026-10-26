import type { EngineConfig, GoMode } from "@/bindings";
import type { EngineSettings } from "./engines";

export const U32_MAX = 4_294_967_295;
export const ANALYSIS_TIME_STOPS = [
    50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
    1800000, 3600000,
];
export const ANALYSIS_TIME_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000 };
export type AnalysisTimeUnit = keyof typeof ANALYSIS_TIME_UNITS;

export function analysisLines(settings: EngineSettings): number | undefined {
    const option = settings.find((setting) => setting.name === "MultiPV");
    return option ? Number(option.value) : undefined;
}

export function analysisLineBounds(config: EngineConfig) {
    const option = config.options.find(
        (option) => option.type === "spin" && option.value.name === "MultiPV",
    );
    if (option?.type !== "spin") return null;
    const min = Number(option.value.min),
        max = Number(option.value.max);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < Math.max(1, min))
        return null;
    return { min: Math.max(1, min), max: Math.max(min, Math.min(8, max)) };
}

export function analysisSearchSummary(go: GoMode): string {
    switch (go.t) {
        case "Depth":
            return `Depth ${go.c}`;
        case "Time":
            return `${go.c / 1000} s per position`;
        case "Nodes":
            return `${go.c.toLocaleString()} nodes per position`;
        case "PlayersTime":
            return "Player clocks";
        case "Infinite":
            return "Until stopped";
    }
}
