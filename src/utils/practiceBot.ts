import type { EngineOption, GoMode } from "@/bindings";
import type { OpponentSettings } from "@/components/boards/OpponentForm";
import type { TimeControlField } from "@/utils/clock";
import type { EngineSettings, LocalEngine } from "@/utils/engines";

export type PracticeBotKind = "maia" | "stockfish";

export type PracticeBotProfile = {
    enabled: boolean;
    kind: PracticeBotKind;
    fideElo: number;
    maiaWeightsPath?: string | null;
    timeUse?: "fast" | "balanced" | "slow";
};

export type PracticeBotMoveDelay = {
    minMs: number;
    maxMs: number;
};

const STOCKFISH_MIN_UCI_ELO = 1320;
const STOCKFISH_MAX_UCI_ELO = 3190;

export const DEFAULT_PRACTICE_BOT_ELO = 1600;

export const PRACTICE_BOT_DEFAULT_TIME_CONTROL: TimeControlField = {
    seconds: 180_000,
    increment: 2_000,
};

export const DEFAULT_PRACTICE_BOT_PROFILE: PracticeBotProfile = {
    enabled: true,
    kind: "stockfish",
    fideElo: DEFAULT_PRACTICE_BOT_ELO,
    timeUse: "balanced",
};

const FIDE_TO_LICHESS_CLASSICAL_ANCHORS: [number, number][] = [
    [1400, 1600],
    [1450, 1665],
    [1500, 1730],
    [1550, 1795],
    [1600, 1850],
    [1650, 1910],
    [1700, 1970],
    [1750, 2030],
    [1800, 2090],
    [1850, 2150],
    [1910, 2225],
    [2000, 2310],
    [2100, 2370],
    [2200, 2410],
    [2300, 2440],
    [2400, 2470],
];

const MAIA_LEGACY_MODELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function interpolateAnchors(value: number, anchors: [number, number][]) {
    if (value <= anchors[0][0]) {
        const [x1, y1] = anchors[0];
        const [x2, y2] = anchors[1];
        const slope = (y2 - y1) / (x2 - x1);
        return y1 + (value - x1) * slope;
    }

    for (let i = 0; i < anchors.length - 1; i++) {
        const [x1, y1] = anchors[i];
        const [x2, y2] = anchors[i + 1];
        if (value >= x1 && value <= x2) {
            const ratio = (value - x1) / (x2 - x1);
            return y1 + ratio * (y2 - y1);
        }
    }

    const [x1, y1] = anchors[anchors.length - 2];
    const [x2, y2] = anchors[anchors.length - 1];
    const slope = (y2 - y1) / (x2 - x1);
    return y2 + (value - x2) * slope;
}

export function fideToLichessClassical(fideElo: number) {
    return Math.round(
        clamp(interpolateAnchors(fideElo, FIDE_TO_LICHESS_CLASSICAL_ANCHORS), 600, 2600),
    );
}

export function nearestLegacyMaiaModel(fideElo: number) {
    const lichessTarget = fideToLichessClassical(fideElo);
    return MAIA_LEGACY_MODELS.reduce((best, model) =>
        Math.abs(model - lichessTarget) < Math.abs(best - lichessTarget) ? model : best,
    );
}

export function stockfishUciEloFromFide(fideElo: number) {
    return Math.round(clamp(fideElo, STOCKFISH_MIN_UCI_ELO, STOCKFISH_MAX_UCI_ELO));
}

export function stockfishSkillLevelFromFide(fideElo: number) {
    return Math.round(clamp(((fideElo - 800) / 200) * 3, 0, 20));
}

export function formatPracticeBotName(profile: PracticeBotProfile) {
    if (profile.kind === "maia") {
        return `Maia ${profile.fideElo} FIDE`;
    }
    return `Stockfish ${profile.fideElo} FIDE`;
}

export function isLikelyLc0Engine(engine: LocalEngine | null | undefined) {
    if (!engine) return false;
    return /(?:lc0|leela|maia)/i.test(`${engine.name} ${engine.path}`);
}

export function isLikelyStockfishEngine(engine: LocalEngine | null | undefined) {
    if (!engine) return false;
    return /stockfish/i.test(`${engine.name} ${engine.path}`);
}

export function createDefaultPracticeBotProfile(engine?: LocalEngine | null): PracticeBotProfile {
    if (isLikelyLc0Engine(engine)) {
        const weightsPath = engine?.settings?.find(
            (option) => option.name === "WeightsFile",
        )?.value;
        return {
            ...DEFAULT_PRACTICE_BOT_PROFILE,
            kind: "maia",
            maiaWeightsPath: typeof weightsPath === "string" ? weightsPath : null,
        };
    }
    return { ...DEFAULT_PRACTICE_BOT_PROFILE };
}

export function createDefaultPracticeBotOpponent(engine: LocalEngine | null): OpponentSettings {
    return {
        type: "engine",
        engine,
        go: { t: "Depth", c: 16 },
        timeControl: PRACTICE_BOT_DEFAULT_TIME_CONTROL,
        timeUnit: "m",
        incrementUnit: "s",
        engineSettings: engine?.settings || undefined,
        botProfile: createDefaultPracticeBotProfile(engine),
    };
}

export function createDefaultHumanOpponent(name = "Player"): OpponentSettings {
    return {
        type: "human",
        name,
        timeControl: PRACTICE_BOT_DEFAULT_TIME_CONTROL,
        timeUnit: "m",
        incrementUnit: "s",
    };
}

function normalizeOptionValue(value: string | number | boolean | null | undefined) {
    if (value === null || value === undefined) return "";
    return value.toString();
}

function upsertOption(options: EngineOption[], name: string, value: string | number | boolean) {
    const index = options.findIndex((option) => option.name === name);
    const next = { name, value: value.toString() };
    if (index === -1) {
        return [...options, next];
    }
    return options.map((option, i) => (i === index ? next : option));
}

export function buildPracticeBotOptions(
    engineSettings: EngineSettings | undefined,
    profile: PracticeBotProfile | null,
) {
    let options = (engineSettings ?? [])
        .filter((setting) => setting.name !== "MultiPV")
        .map((setting) => ({
            name: setting.name,
            value: normalizeOptionValue(setting.value),
        }));

    if (!profile?.enabled) {
        return options;
    }

    if (profile.kind === "stockfish") {
        options = upsertOption(options, "UCI_LimitStrength", "true");
        options = upsertOption(options, "UCI_Elo", stockfishUciEloFromFide(profile.fideElo));
        options = upsertOption(
            options,
            "Skill Level",
            stockfishSkillLevelFromFide(profile.fideElo),
        );
        return options;
    }

    if (profile.maiaWeightsPath) {
        options = upsertOption(options, "WeightsFile", profile.maiaWeightsPath);
    }

    return options;
}

export function getPracticeBotGoMode(profile: PracticeBotProfile | null, fallback: GoMode): GoMode {
    if (profile?.enabled && profile.kind === "maia") {
        return { t: "Nodes", c: 1 };
    }
    return fallback;
}

export function shouldUseClockTimeManagement(profile: PracticeBotProfile | null) {
    return !(profile?.enabled && profile.kind === "maia");
}

export function getPracticeBotMoveDelay(
    profile: PracticeBotProfile | null,
    timeControl?: TimeControlField,
): PracticeBotMoveDelay | null {
    if (!profile?.enabled || profile.kind !== "maia") return null;

    const initialSeconds =
        (timeControl?.seconds ?? PRACTICE_BOT_DEFAULT_TIME_CONTROL.seconds) / 1000;
    const base = initialSeconds <= 180 ? 350 : initialSeconds <= 600 ? 650 : 1000;

    if (profile.timeUse === "fast") {
        return { minMs: Math.round(base * 0.35), maxMs: Math.round(base * 1.2) };
    }
    if (profile.timeUse === "slow") {
        return { minMs: Math.round(base * 0.9), maxMs: Math.round(base * 2.6) };
    }
    return { minMs: Math.round(base * 0.55), maxMs: Math.round(base * 1.8) };
}
