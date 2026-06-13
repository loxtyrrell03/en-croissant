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

export type PracticeBotKind = "patricia" | "maia" | "stockfish";

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
    strengthElo?: number;
    initialTimeMs?: number;
    incrementMs?: number;
    useAsMoveTime?: boolean;
};

export type PracticeBotTimeClass = "bullet" | "blitz" | "rapid" | "classical";

const MANAGED_PATRICIA_VERSION = "5";
const MANAGED_PATRICIA_ENGINE_ID = "managed-patricia-trainer";
const MANAGED_MAIA_ENGINE_VERSION = "0.32.1";
const MANAGED_MAIA_ENGINE_ID = "managed-maia-lc0";
const MANAGED_MAIA_WEIGHTS_VERSION = "v1.0";
const MANAGED_TRAINER_DIR = "trainer-bot";
const MANAGED_MAIA_DIR = "maia";
const MANAGED_MAIA_WEIGHTS_DIR = "weights";
const PATRICIA_MIN_FIDE_ELO = 800;
const PATRICIA_MAX_FIDE_ELO = 3000;
const MAIA_MIN_ELO = 1100;
const MAIA_MAX_ELO = 1900;

export const DEFAULT_BLINDFOLD_MAIA_ELO = 1500;

export const DEFAULT_PRACTICE_BOT_ELO = 1600;

export const PRACTICE_BOT_DEFAULT_TIME_CONTROL: TimeControlField = {
    seconds: 180_000,
    increment: 2_000,
};

export const DEFAULT_PRACTICE_BOT_PROFILE: PracticeBotProfile = {
    enabled: true,
    kind: "patricia",
    fideElo: DEFAULT_PRACTICE_BOT_ELO,
    timeUse: "balanced",
};

const PATRICIA_SKILL_LEVELS = [
    500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400,
    2500, 2650, 2800, 3000,
] as const;

const MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900] as const;

// Rating-equivalent move-quality handicap; keep in sync with src-tauri/src/game.rs.
const TRAINER_QUALITY_PENALTY_POINTS = [
    { secondsPerMove: 1.5, penalty: 700 },
    { secondsPerMove: 3, penalty: 460 },
    { secondsPerMove: 7, penalty: 225 },
    { secondsPerMove: 20, penalty: 60 },
    { secondsPerMove: 45, penalty: 0 },
] as const;

const MANAGED_PATRICIA_PACKAGES: Partial<
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
        // v2 is the wider-compatibility SSE build; v3 needs AVX2.
        url: `https://github.com/Adam-Kulju/Patricia/releases/download/${MANAGED_PATRICIA_VERSION}/patricia_v2.exe`,
        directory: `patricia-${MANAGED_PATRICIA_VERSION}`,
        executable: "patricia_v2.exe",
        size: 4_142_592,
    },
};

const MANAGED_MAIA_PACKAGES: Partial<
    Record<
        Platform,
        {
            url: string;
            directory?: string;
            executable: string;
            size: number;
        }
    >
> = {
    windows: {
        url: `https://github.com/LeelaChessZero/lc0/releases/download/v${MANAGED_MAIA_ENGINE_VERSION}/lc0-v${MANAGED_MAIA_ENGINE_VERSION}-windows-cpu-dnnl.zip`,
        executable: "lc0.exe",
        size: 24_001_097,
    },
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function estimatedGameSeconds(timeControl: TimeControlField) {
    return (timeControl.seconds + (timeControl.increment ?? 0) * 40) / 1000;
}

export function practiceBotTimeClass(
    timeControl: TimeControlField = PRACTICE_BOT_DEFAULT_TIME_CONTROL,
): PracticeBotTimeClass {
    const totalSeconds = estimatedGameSeconds(timeControl);
    if (totalSeconds <= 179) return "bullet";
    if (totalSeconds <= 479) return "blitz";
    if (totalSeconds <= 1499) return "rapid";
    return "classical";
}

export function practiceBotEstimatedSecondsPerMove(
    timeControl: TimeControlField = PRACTICE_BOT_DEFAULT_TIME_CONTROL,
) {
    return estimatedGameSeconds(timeControl) / 40;
}

function ratingQualityPenaltyScale(fideElo: number) {
    const clamped = clamp(fideElo, PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO);
    if (clamped <= 2200) {
        return 0.72 + ((clamped - PATRICIA_MIN_FIDE_ELO) / 1400) * 0.28;
    }
    return 1 + ((clamped - 2200) / 800) * 0.12;
}

function qualityPenaltyForSecondsPerMove(secondsPerMove: number, fideElo: number) {
    const seconds = Math.max(0.1, secondsPerMove);
    const points = TRAINER_QUALITY_PENALTY_POINTS;
    let rawPenalty = points[points.length - 1].penalty;

    if (seconds <= points[0].secondsPerMove) {
        rawPenalty = points[0].penalty + (points[0].secondsPerMove - seconds) * 90;
    } else {
        for (let i = 1; i < points.length; i++) {
            const previous = points[i - 1];
            const next = points[i];
            if (seconds <= next.secondsPerMove) {
                const t =
                    (seconds - previous.secondsPerMove) /
                    (next.secondsPerMove - previous.secondsPerMove);
                rawPenalty = previous.penalty + (next.penalty - previous.penalty) * t;
                break;
            }
        }
    }

    return Math.round(clamp(rawPenalty * ratingQualityPenaltyScale(fideElo), 0, 850));
}

export function practiceBotTimeControlQualityPenalty(
    fideElo: number,
    timeControl?: TimeControlField,
) {
    if (!timeControl) return 0;
    return qualityPenaltyForSecondsPerMove(
        practiceBotEstimatedSecondsPerMove(timeControl),
        fideElo,
    );
}

export function practiceBotEffectiveEloFromFide(fideElo: number, timeControl?: TimeControlField) {
    return Math.round(
        clamp(
            fideElo - practiceBotTimeControlQualityPenalty(fideElo, timeControl),
            PATRICIA_MIN_FIDE_ELO,
            PATRICIA_MAX_FIDE_ELO,
        ),
    );
}

export function patriciaTrainerEloFromFide(fideElo: number, timeControl?: TimeControlField) {
    return practiceBotEffectiveEloFromFide(fideElo, timeControl);
}

export function patriciaSkillLevelFromFide(fideElo: number, timeControl?: TimeControlField) {
    const target = patriciaTrainerEloFromFide(fideElo, timeControl);
    const index = PATRICIA_SKILL_LEVELS.reduce(
        (bestIndex, elo, index) =>
            Math.abs(elo - target) < Math.abs(PATRICIA_SKILL_LEVELS[bestIndex] - target)
                ? index
                : bestIndex,
        0,
    );
    return index + 1;
}

export function patriciaSkillLevelElo(skillLevel: number) {
    const index = clamp(Math.round(skillLevel), 1, PATRICIA_SKILL_LEVELS.length) - 1;
    return PATRICIA_SKILL_LEVELS[index];
}

export function maiaLevelFromElo(fideElo: number) {
    const target = clamp(Math.round(fideElo), MAIA_MIN_ELO, MAIA_MAX_ELO);
    return MAIA_LEVELS.reduce((best, elo) =>
        Math.abs(elo - target) < Math.abs(best - target) ? elo : best,
    );
}

export function practiceBotBackendKind(profile: PracticeBotProfile | null): PracticeBotKind {
    if (!profile?.enabled) return "patricia";
    return profile.kind === "maia" ? "maia" : "patricia";
}

export function describePracticeBotBackend(
    profile: PracticeBotProfile,
    timeControl?: TimeControlField,
) {
    if (profile.kind === "maia") {
        const level = maiaLevelFromElo(profile.fideElo);
        const weights = profile.maiaWeightsPath ? "custom weights" : `${level} level`;
        return `Maia human model - ${weights}`;
    }

    const skillLevel = patriciaSkillLevelFromFide(profile.fideElo, timeControl);
    const targetElo = patriciaTrainerEloFromFide(profile.fideElo, timeControl);
    const penalty = practiceBotTimeControlQualityPenalty(profile.fideElo, timeControl);
    if (timeControl && penalty > 0) {
        return `Patricia human mode - Skill ${skillLevel}, ${profile.fideElo} FIDE classical -> ${targetElo} ${practiceBotTimeClass(timeControl)} quality`;
    }
    return `Patricia human mode - Skill ${skillLevel}, target ${targetElo} FIDE`;
}

export function formatPracticeBotName(profile: PracticeBotProfile, timeControl?: TimeControlField) {
    if (profile.kind === "maia") {
        return `Maia ${maiaLevelFromElo(profile.fideElo)}`;
    }

    const targetElo = patriciaTrainerEloFromFide(profile.fideElo, timeControl);
    const penalty = practiceBotTimeControlQualityPenalty(profile.fideElo, timeControl);
    if (timeControl && penalty > 0) {
        return `Patricia ${profile.fideElo} FIDE (${targetElo} ${practiceBotTimeClass(timeControl)})`;
    }
    return `Patricia ${targetElo} FIDE`;
}

export function isLikelyPatriciaEngine(engine: LocalEngine | null | undefined) {
    if (!engine) return false;
    return /patricia/i.test(`${engine.name} ${engine.path}`);
}

export function isLikelyMaiaEngine(engine: LocalEngine | null | undefined) {
    if (!engine) return false;
    return /\b(maia|lc0|lczero|leela)\b/i.test(`${engine.name} ${engine.path}`);
}

export function createDefaultPracticeBotProfile(engine?: LocalEngine | null): PracticeBotProfile {
    return {
        ...DEFAULT_PRACTICE_BOT_PROFILE,
        kind: isLikelyPatriciaEngine(engine) ? "patricia" : DEFAULT_PRACTICE_BOT_PROFILE.kind,
    };
}

export function createDefaultMaiaProfile(fideElo = DEFAULT_BLINDFOLD_MAIA_ELO): PracticeBotProfile {
    return {
        enabled: true,
        kind: "maia",
        fideElo: maiaLevelFromElo(fideElo),
        timeUse: "balanced",
    };
}

export function createDefaultPracticeBotOpponent(
    engine: LocalEngine | null = null,
): OpponentSettings {
    return {
        type: "engine",
        engine: isLikelyPatriciaEngine(engine) ? engine : null,
        go: { t: "Time", c: 500 },
        timeControl: PRACTICE_BOT_DEFAULT_TIME_CONTROL,
        timeUnit: "m",
        incrementUnit: "s",
        engineSettings: isLikelyPatriciaEngine(engine) ? engine?.settings || undefined : undefined,
        botProfile: createDefaultPracticeBotProfile(engine),
    };
}

export function createDefaultMaiaOpponent(
    engine: LocalEngine | null = null,
    fideElo = DEFAULT_BLINDFOLD_MAIA_ELO,
): OpponentSettings {
    return {
        type: "engine",
        engine,
        go: { t: "Time", c: 500 },
        timeControl: PRACTICE_BOT_DEFAULT_TIME_CONTROL,
        timeUnit: "m",
        incrementUnit: "s",
        engineSettings: engine?.settings || undefined,
        botProfile: createDefaultMaiaProfile(fideElo),
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

function getSettingValue(settings: EngineSettings | undefined, name: string) {
    return settings?.find((setting) => setting.name === name)?.value;
}

function getMaiaWeightsFileSetting(settings: EngineSettings | undefined) {
    const value = getSettingValue(settings, "WeightsFile");
    return typeof value === "string" && value.trim() ? value : null;
}

function upsertEngineSetting(
    settings: EngineSettings | undefined,
    name: string,
    value: string | number | boolean,
): EngineSettings {
    const existing = settings ?? [];
    const index = existing.findIndex((setting) => setting.name === name);
    const next = { name, value };
    if (index === -1) return [...existing, next];
    return existing.map((setting, i) => (i === index ? next : setting));
}

export function buildPracticeBotOptions(
    engineSettings: EngineSettings | undefined,
    profile: PracticeBotProfile | null,
    timeControl?: TimeControlField,
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

    if (profile.kind === "maia") {
        if (profile.maiaWeightsPath) {
            options = upsertOption(options, "WeightsFile", profile.maiaWeightsPath);
        }
        return options;
    }

    const targetElo = patriciaTrainerEloFromFide(profile.fideElo, timeControl);
    options = upsertOption(options, "UCI_LimitStrength", "true");
    options = upsertOption(options, "UCI_Elo", targetElo);
    options = upsertOption(
        options,
        "Skill_Level",
        patriciaSkillLevelFromFide(profile.fideElo, timeControl),
    );
    return options;
}

export function getPracticeBotGoMode(profile: PracticeBotProfile | null, fallback: GoMode): GoMode {
    if (profile?.enabled) {
        return { t: "Time", c: 500 };
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
    const strengthElo = patriciaTrainerEloFromFide(profile.fideElo, timeControl);
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
            strengthElo,
            initialTimeMs,
            incrementMs,
            useAsMoveTime: true,
        };
    }
    if (profile.timeUse === "slow") {
        return {
            minMs: Math.round(base * 0.9),
            maxMs: Math.max(Math.round(base * 2.6), max),
            fideElo: profile.fideElo,
            strengthElo,
            initialTimeMs,
            incrementMs,
            useAsMoveTime: true,
        };
    }
    return {
        minMs: Math.round(base * 0.55),
        maxMs: Math.max(Math.round(base * 1.8), max),
        fideElo: profile.fideElo,
        strengthElo,
        initialTimeMs,
        incrementMs,
        useAsMoveTime: true,
    };
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

async function getManagedTrainerDir() {
    const enginesDir = await getEnginesDir();
    return resolve(enginesDir, MANAGED_TRAINER_DIR);
}

async function getManagedMaiaWeightsPath(fideElo: number) {
    const level = maiaLevelFromElo(fideElo);
    const trainerDir = await getManagedTrainerDir();
    const maiaDir = await resolve(trainerDir, MANAGED_MAIA_DIR);
    const weightsDir = await resolve(maiaDir, MANAGED_MAIA_WEIGHTS_DIR);
    return resolve(weightsDir, `maia-${level}.pb.gz`);
}

async function ensureManagedMaiaWeights(fideElo: number) {
    const level = maiaLevelFromElo(fideElo);
    const weightsPath = await getManagedMaiaWeightsPath(level);
    if (!(await pathExists(weightsPath))) {
        const trainerDir = await getManagedTrainerDir();
        const maiaDir = await resolve(trainerDir, MANAGED_MAIA_DIR);
        const weightsDir = await resolve(maiaDir, MANAGED_MAIA_WEIGHTS_DIR);
        await ensureDirectory(weightsDir);
        unwrap(
            await commands.downloadFile(
                `practice_bot_maia_${level}`,
                `https://github.com/CSSLab/maia-chess/releases/download/${MANAGED_MAIA_WEIGHTS_VERSION}/maia-${level}.pb.gz`,
                weightsPath,
                null,
                true,
                null,
            ),
        );
    }
    return weightsPath;
}

export async function ensureManagedMaiaEngine(
    fideElo = DEFAULT_BLINDFOLD_MAIA_ELO,
): Promise<LocalEngine> {
    const os = await platform();
    const pkg = MANAGED_MAIA_PACKAGES[os];
    if (!pkg) {
        throw new Error("Managed Maia trainer is currently packaged for Windows.");
    }

    const trainerDir = await getManagedTrainerDir();
    const maiaDir = await resolve(trainerDir, MANAGED_MAIA_DIR);
    const engineDir = pkg.directory ? await resolve(maiaDir, pkg.directory) : maiaDir;
    const enginePath = await resolve(engineDir, pkg.executable);
    const weightsPath = await ensureManagedMaiaWeights(fideElo);

    if (!(await pathExists(enginePath))) {
        await ensureDirectory(maiaDir);
        unwrap(
            await commands.downloadFile(
                "practice_bot_maia_lc0",
                pkg.url,
                maiaDir,
                null,
                true,
                pkg.size,
            ),
        );
        unwrap(await commands.setFileAsExecutable(enginePath));
    }

    return {
        type: "local",
        id: MANAGED_MAIA_ENGINE_ID,
        name: "Maia Human Trainer",
        version: `lc0 ${MANAGED_MAIA_ENGINE_VERSION}`,
        path: enginePath,
        loaded: true,
        elo: maiaLevelFromElo(fideElo),
        settings: [{ name: "WeightsFile", value: weightsPath }],
    };
}

async function ensureManagedPatriciaEngine(): Promise<LocalEngine> {
    const os = await platform();
    const pkg = MANAGED_PATRICIA_PACKAGES[os];
    if (!pkg) {
        throw new Error("Managed Patricia trainer is currently packaged for Windows.");
    }

    const trainerDir = await getManagedTrainerDir();
    const patriciaDir = await resolve(trainerDir, pkg.directory);
    const patriciaPath = await resolve(patriciaDir, pkg.executable);

    if (!(await pathExists(patriciaPath))) {
        await ensureDirectory(patriciaDir);
        unwrap(
            await commands.downloadFile(
                "practice_bot_patricia",
                pkg.url,
                patriciaPath,
                null,
                true,
                pkg.size,
            ),
        );
        unwrap(await commands.setFileAsExecutable(patriciaPath));
    }

    return {
        type: "local",
        id: MANAGED_PATRICIA_ENGINE_ID,
        name: "Patricia Human Trainer",
        version: MANAGED_PATRICIA_VERSION,
        path: patriciaPath,
        loaded: true,
        elo: PATRICIA_MAX_FIDE_ELO,
        settings: [],
    };
}

export async function preparePracticeBotOpponent(
    settings: OpponentSettings,
): Promise<OpponentSettings> {
    if (settings.type !== "engine" || !settings.botProfile?.enabled) {
        return settings;
    }

    const profile: PracticeBotProfile = {
        ...DEFAULT_PRACTICE_BOT_PROFILE,
        ...settings.botProfile,
        enabled: true,
    };

    if (profile.kind === "maia") {
        const level = maiaLevelFromElo(profile.fideElo);
        const selectedEngineExists = settings.engine?.path
            ? await pathExists(settings.engine.path)
            : false;
        const engine =
            settings.engine?.path && selectedEngineExists
                ? settings.engine
                : await ensureManagedMaiaEngine(level);
        const engineSettings = settings.engineSettings ?? engine.settings ?? undefined;
        const configuredWeights =
            profile.maiaWeightsPath || getMaiaWeightsFileSetting(engineSettings);
        const weightsPath =
            configuredWeights && (await pathExists(configuredWeights))
                ? configuredWeights
                : await ensureManagedMaiaWeights(level);

        return {
            ...settings,
            engine,
            engineSettings: upsertEngineSetting(engineSettings, "WeightsFile", weightsPath),
            go: settings.go ?? { t: "Time", c: 500 },
            botProfile: {
                ...profile,
                fideElo: level,
                maiaWeightsPath: weightsPath,
            },
        };
    }

    profile.kind = "patricia";

    const engine = isLikelyPatriciaEngine(settings.engine)
        ? settings.engine!
        : await ensureManagedPatriciaEngine();

    return {
        ...settings,
        engine,
        engineSettings: engine.settings || undefined,
        go: { t: "Time", c: 500 },
        botProfile: profile,
    };
}
