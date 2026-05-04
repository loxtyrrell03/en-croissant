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
    initialTimeMs?: number;
    incrementMs?: number;
    useAsMoveTime?: boolean;
};

const MANAGED_PATRICIA_VERSION = "5";
const MANAGED_PATRICIA_ENGINE_ID = "managed-patricia-trainer";
const MANAGED_TRAINER_DIR = "trainer-bot";
const PATRICIA_MIN_FIDE_ELO = 800;
const PATRICIA_MAX_FIDE_ELO = 3000;

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
    500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100,
    2200, 2300, 2400, 2500, 2650, 2800, 3000,
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

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function patriciaTrainerEloFromFide(fideElo: number) {
    return Math.round(clamp(fideElo, PATRICIA_MIN_FIDE_ELO, PATRICIA_MAX_FIDE_ELO));
}

export function patriciaSkillLevelFromFide(fideElo: number) {
    const target = patriciaTrainerEloFromFide(fideElo);
    const index = PATRICIA_SKILL_LEVELS.reduce((bestIndex, elo, index) =>
        Math.abs(elo - target) < Math.abs(PATRICIA_SKILL_LEVELS[bestIndex] - target)
            ? index
            : bestIndex,
    0);
    return index + 1;
}

export function patriciaSkillLevelElo(skillLevel: number) {
    const index = clamp(Math.round(skillLevel), 1, PATRICIA_SKILL_LEVELS.length) - 1;
    return PATRICIA_SKILL_LEVELS[index];
}

export function practiceBotBackendKind(profile: PracticeBotProfile | null): PracticeBotKind {
    if (!profile?.enabled) return "patricia";
    return "patricia";
}

export function describePracticeBotBackend(profile: PracticeBotProfile) {
    const skillLevel = patriciaSkillLevelFromFide(profile.fideElo);
    const targetElo = patriciaTrainerEloFromFide(profile.fideElo);
    return `Patricia human mode - Skill ${skillLevel}, target ${targetElo} FIDE`;
}

export function formatPracticeBotName(profile: PracticeBotProfile) {
    return `Patricia ${patriciaTrainerEloFromFide(profile.fideElo)} FIDE`;
}

export function isLikelyPatriciaEngine(engine: LocalEngine | null | undefined) {
    if (!engine) return false;
    return /patricia/i.test(`${engine.name} ${engine.path}`);
}

export function createDefaultPracticeBotProfile(engine?: LocalEngine | null): PracticeBotProfile {
    return {
        ...DEFAULT_PRACTICE_BOT_PROFILE,
        kind: isLikelyPatriciaEngine(engine) ? "patricia" : DEFAULT_PRACTICE_BOT_PROFILE.kind,
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

    const targetElo = patriciaTrainerEloFromFide(profile.fideElo);
    options = upsertOption(options, "UCI_LimitStrength", "true");
    options = upsertOption(options, "UCI_Elo", targetElo);
    options = upsertOption(options, "Skill_Level", patriciaSkillLevelFromFide(profile.fideElo));
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
            useAsMoveTime: true,
        };
    }
    if (profile.timeUse === "slow") {
        return {
            minMs: Math.round(base * 0.9),
            maxMs: Math.max(Math.round(base * 2.6), max),
            fideElo: profile.fideElo,
            initialTimeMs,
            incrementMs,
            useAsMoveTime: true,
        };
    }
    return {
        minMs: Math.round(base * 0.55),
        maxMs: Math.max(Math.round(base * 1.8), max),
        fideElo: profile.fideElo,
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

async function ensureManagedPatriciaEngine(): Promise<LocalEngine> {
    const os = await platform();
    const pkg = MANAGED_PATRICIA_PACKAGES[os];
    if (!pkg) {
        throw new Error("Managed Patricia trainer is currently packaged for Windows.");
    }

    const enginesDir = await getEnginesDir();
    const trainerDir = await resolve(enginesDir, MANAGED_TRAINER_DIR);
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

    const profile = {
        ...DEFAULT_PRACTICE_BOT_PROFILE,
        ...settings.botProfile,
        enabled: true,
        kind: "patricia" as const,
    };

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
