import type { EngineOption, GoMode } from "@/bindings";
import { commands } from "@/bindings";
import type { OpponentSettings } from "@/components/boards/OpponentForm";
import type { TimeControlField } from "@/utils/clock";
import { getEnginesDir } from "@/utils/directories";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import { unwrap } from "@/utils/unwrap";
import { resolve } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { platform, type Platform } from "@tauri-apps/plugin-os";

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
    fideElo?: number;
    initialTimeMs?: number;
    incrementMs?: number;
    useAsMoveTime?: boolean;
};

const STOCKFISH_MIN_UCI_ELO = 1320;
const STOCKFISH_MAX_UCI_ELO = 3190;
const MANAGED_MAIA_LC0_VERSION = "0.32.1";
const MANAGED_MAIA_ENGINE_ID = "managed-maia-lc0";
const MANAGED_MAIA_DIR = "trainer-bot";

export const DEFAULT_PRACTICE_BOT_ELO = 1600;

export const PRACTICE_BOT_DEFAULT_TIME_CONTROL: TimeControlField = {
    seconds: 180_000,
    increment: 2_000,
};

export const DEFAULT_PRACTICE_BOT_PROFILE: PracticeBotProfile = {
    enabled: true,
    kind: "maia",
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

const MANAGED_LC0_PACKAGES: Partial<
    Record<
        Platform,
        {
            url: string;
            directory: string;
            executable: string;
            size: number;
        }
    >
> = {
    windows: {
        url: `https://github.com/LeelaChessZero/lc0/releases/download/v${MANAGED_MAIA_LC0_VERSION}/lc0-v${MANAGED_MAIA_LC0_VERSION}-windows-cpu-openblas.zip`,
        directory: `lc0-v${MANAGED_MAIA_LC0_VERSION}-windows-cpu-openblas`,
        executable: "lc0.exe",
        size: 23_818_982,
    },
};

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

export function createDefaultPracticeBotOpponent(
    engine: LocalEngine | null = null,
): OpponentSettings {
    return {
        type: "engine",
        engine: isLikelyLc0Engine(engine) ? engine : null,
        go: { t: "Nodes", c: 1 },
        timeControl: PRACTICE_BOT_DEFAULT_TIME_CONTROL,
        timeUnit: "m",
        incrementUnit: "s",
        engineSettings: isLikelyLc0Engine(engine) ? engine?.settings || undefined : undefined,
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
    return !profile?.enabled;
}

export function getPracticeBotMoveDelay(
    profile: PracticeBotProfile | null,
    timeControl?: TimeControlField,
): PracticeBotMoveDelay | null {
    if (!profile?.enabled) return null;

    const initialSeconds =
        (timeControl?.seconds ?? PRACTICE_BOT_DEFAULT_TIME_CONTROL.seconds) / 1000;
    const initialTimeMs = timeControl?.seconds ?? PRACTICE_BOT_DEFAULT_TIME_CONTROL.seconds;
    const incrementMs = timeControl?.increment ?? 0;
    const base =
        initialSeconds <= 60
            ? 120
            : initialSeconds <= 180
              ? 220
              : initialSeconds <= 600
                ? 420
                : 750;
    const max = Math.round(
        initialSeconds <= 60
            ? initialTimeMs * 0.08
            : initialSeconds <= 180
              ? initialTimeMs * 0.055
              : initialSeconds <= 600
                ? initialTimeMs * 0.04
                : initialTimeMs * 0.025,
    );

    if (profile.timeUse === "fast") {
        return {
            minMs: Math.round(base * 0.35),
            maxMs: Math.max(Math.round(base * 1.2), max),
            fideElo: profile.fideElo,
            initialTimeMs,
            incrementMs,
            useAsMoveTime: profile.kind === "stockfish",
        };
    }
    if (profile.timeUse === "slow") {
        return {
            minMs: Math.round(base * 0.9),
            maxMs: Math.max(Math.round(base * 2.6), max),
            fideElo: profile.fideElo,
            initialTimeMs,
            incrementMs,
            useAsMoveTime: profile.kind === "stockfish",
        };
    }
    return {
        minMs: Math.round(base * 0.55),
        maxMs: Math.max(Math.round(base * 1.8), max),
        fideElo: profile.fideElo,
        initialTimeMs,
        incrementMs,
        useAsMoveTime: profile.kind === "stockfish",
    };
}

export function maiaWeightsFileName(model: number) {
    return `maia-${model}.pb.gz`;
}

export function maiaWeightsUrl(model: number) {
    return `https://github.com/CSSLab/maia-chess/releases/download/v1.0/${maiaWeightsFileName(model)}`;
}

async function ensureDirectory(path: string) {
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
}

async function pathExists(path: string) {
    const result = await commands.fileExists(path);
    return result.status === "ok" && result.data;
}

async function ensureManagedLc0Engine(): Promise<LocalEngine> {
    const os = await platform();
    const pkg = MANAGED_LC0_PACKAGES[os];
    if (!pkg) {
        throw new Error("Managed Maia trainer is currently packaged for Windows.");
    }

    const enginesDir = await getEnginesDir();
    const trainerDir = await resolve(enginesDir, MANAGED_MAIA_DIR);
    const lc0Dir = await resolve(trainerDir, pkg.directory);
    const lc0Path = await resolve(lc0Dir, pkg.executable);

    if (!(await pathExists(lc0Path))) {
        await ensureDirectory(lc0Dir);
        unwrap(
            await commands.downloadFile("practice_bot_lc0", pkg.url, lc0Dir, null, true, pkg.size),
        );
        unwrap(await commands.setFileAsExecutable(lc0Path));
    }

    return {
        type: "local",
        id: MANAGED_MAIA_ENGINE_ID,
        name: "Maia Trainer",
        version: MANAGED_MAIA_LC0_VERSION,
        path: lc0Path,
        loaded: true,
        elo: 1900,
        settings: [],
    };
}

async function ensureManagedMaiaWeights(fideElo: number) {
    const model = nearestLegacyMaiaModel(fideElo);
    const enginesDir = await getEnginesDir();
    const weightsDir = await resolve(enginesDir, MANAGED_MAIA_DIR, "maia-weights");
    const weightsPath = await resolve(weightsDir, maiaWeightsFileName(model));

    if (!(await pathExists(weightsPath))) {
        await ensureDirectory(weightsDir);
        unwrap(
            await commands.downloadFile(
                `practice_bot_maia_${model}`,
                maiaWeightsUrl(model),
                weightsPath,
                null,
                true,
                null,
            ),
        );
    }

    return weightsPath;
}

export async function preparePracticeBotOpponent(
    settings: OpponentSettings,
): Promise<OpponentSettings> {
    if (settings.type !== "engine" || !settings.botProfile?.enabled) {
        return settings;
    }

    const profile = {
        ...DEFAULT_PRACTICE_BOT_PROFILE,
        ...settings.botProfile,
        enabled: true,
        kind: settings.botProfile.kind,
    };

    if (profile.kind === "stockfish") {
        return settings;
    }

    const [engine, maiaWeightsPath] = await Promise.all([
        ensureManagedLc0Engine(),
        ensureManagedMaiaWeights(profile.fideElo),
    ]);

    return {
        ...settings,
        engine,
        engineSettings: engine.settings || undefined,
        go: { t: "Nodes", c: 1 },
        botProfile: {
            ...profile,
            maiaWeightsPath,
        },
    };
}
