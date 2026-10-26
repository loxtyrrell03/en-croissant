import {
    normalizeEnginePerformancePreset,
    type EnginePerformancePreset,
} from "@/utils/enginePerformance";
import {
    normalizeLc0NetworkProfile,
    type Lc0NetworkProfile,
    type PcEngineKind,
} from "@/utils/lc0Networks";
export const PHONE_ENGINE_SETTINGS_KEY = "en-croissant-web-engine-panel-settings";
export type PhoneEngineSettings = {
    enabled: boolean;
    useCloud: boolean;
    multipv: number;
    depth: number;
    infinite: boolean;
    engineKind: PcEngineKind;
    stockfishPreset: EnginePerformancePreset;
    lc0Preset: EnginePerformancePreset;
    lc0AutoNetwork: boolean;
    lc0Network: Lc0NetworkProfile;
};
export const DEFAULT_PHONE_ENGINE_SETTINGS: PhoneEngineSettings = {
    enabled: false,
    useCloud: false,
    multipv: 3,
    depth: 14,
    infinite: false,
    engineKind: "stockfish",
    stockfishPreset: "good",
    lc0Preset: "good",
    lc0AutoNetwork: true,
    lc0Network: "none",
};
const whole = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};
export function normalizePhoneEngineSettings(
    value: Partial<PhoneEngineSettings> | null | undefined,
): PhoneEngineSettings {
    return {
        enabled: Boolean(value?.enabled),
        useCloud: value?.useCloud !== false,
        multipv: whole(value?.multipv, 1, 8, DEFAULT_PHONE_ENGINE_SETTINGS.multipv),
        depth: whole(value?.depth, 6, 70, DEFAULT_PHONE_ENGINE_SETTINGS.depth),
        infinite: Boolean(value?.infinite),
        engineKind: value?.engineKind === "lc0" ? "lc0" : "stockfish",
        stockfishPreset: normalizeEnginePerformancePreset(value?.stockfishPreset),
        lc0Preset: normalizeEnginePerformancePreset(value?.lc0Preset),
        lc0AutoNetwork: value?.lc0AutoNetwork !== false,
        lc0Network: normalizeLc0NetworkProfile(value?.lc0Network),
    };
}
