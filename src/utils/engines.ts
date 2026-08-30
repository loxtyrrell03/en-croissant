import { fetch } from "@tauri-apps/plugin-http";
import { localDataDir, resolve } from "@tauri-apps/api/path";
import type { Platform } from "@tauri-apps/plugin-os";
import useSWR from "swr";
import { z } from "zod";
import {
    type BestMoves,
    commands,
    type EngineOption,
    type EngineOptions,
    type GoMode,
} from "@/bindings";
import { getEnginesDir } from "@/utils/directories";
import { unwrap } from "./unwrap";

export const requiredEngineSettings = ["MultiPV", "Threads", "Hash"];

const goModeSchema: z.ZodSchema<GoMode> = z.union([
    z.object({
        t: z.literal("Depth"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Time"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Nodes"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Infinite"),
    }),
]);

export const engineSettingsSchema = z.array(
    z.object({
        name: z.string(),
        value: z.string().or(z.number()).or(z.boolean()).nullable(),
    }),
);

export type EngineSettings = z.infer<typeof engineSettingsSchema>;

/** Convert persisted nullable UI settings into concrete UCI setoption pairs. */
export function engineSettingsToOptions(
    settings: EngineSettings | null | undefined,
): EngineOption[] {
    return (settings ?? [])
        .filter((setting) => setting.name.trim() && setting.value !== null)
        .map((setting) => ({
            name: setting.name,
            value: String(setting.value),
        }));
}

const localEngineSchema = z.object({
    type: z.literal("local"),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    version: z.string(),
    path: z.string(),
    image: z.string().nullish(),
    elo: z.number().nullish(),
    downloadSize: z.number().nullish(),
    downloadLink: z.string().nullish(),
    managedInstall: z.literal("chessbot-lc0-0.32.1").nullish(),
    loaded: z.boolean().nullish(),
    go: goModeSchema.nullish(),
    enabled: z.boolean().nullish(),
    settings: engineSettingsSchema.nullish(),
});

export type LocalEngine = z.output<typeof localEngineSchema>;

const MANAGED_STOCKFISH_ID = "managed-stockfish-18";
const MANAGED_LC0_ID = "managed-lc0-0.32.1-bt4-it332";

function normalizeEnginePath(path: string): string {
    return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function mergeEngineSettings(
    current: EngineSettings | null | undefined,
    required: EngineSettings | null | undefined,
): EngineSettings | undefined {
    const merged = new Map<string, EngineSettings[number]>();
    for (const setting of current ?? []) {
        merged.set(setting.name.toLowerCase(), setting);
    }
    for (const setting of required ?? []) {
        merged.set(setting.name.toLowerCase(), setting);
    }
    return merged.size > 0 ? [...merged.values()] : undefined;
}

/**
 * Reconcile verified/versioned desktop installs with the persisted engine
 * list. Matching paths keep their existing id so per-tab settings survive;
 * missing managed profiles are appended without disturbing remote engines or
 * the user's chosen ordering.
 */
export function mergeInstalledDesktopEngines(
    engines: Engine[],
    installed: LocalEngine[],
): Engine[] {
    const next = [...engines];
    for (const managed of installed) {
        const managedPath = normalizeEnginePath(managed.path);
        const index = next.findIndex(
            (engine) =>
                engine.id === managed.id ||
                (engine.type === "local" && normalizeEnginePath(engine.path) === managedPath),
        );
        if (index < 0) {
            next.push(managed);
            continue;
        }
        const existing = next[index];
        if (existing.type !== "local") continue;
        next[index] = {
            ...existing,
            ...managed,
            id: existing.id,
            settings: mergeEngineSettings(existing.settings, managed.settings),
        };
    }
    return next;
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
    for (const path of candidates) {
        try {
            const result = await commands.fileExists(path);
            if (result.status === "ok" && result.data) return path;
        } catch {
            // A candidate outside an older app's filesystem scope is simply
            // unavailable; the next versioned location may still exist.
        }
    }
    return null;
}

/**
 * Find the exact versioned engine installs shared with the ChessBot setup on
 * this Windows account. This is read-only and never launches or prewarms an
 * engine; the normal feature action remains the only process-start boundary.
 */
export async function discoverInstalledDesktopEngines(): Promise<LocalEngine[]> {
    const localData = await localDataDir();
    const enginesDir = await getEnginesDir();
    const stockfishDir = await resolve(localData, "Programs", "Stockfish", "18", "stockfish");
    const stockfishPath = await firstExistingPath(
        [
            "stockfish-windows-x86-64-avxvnni.exe",
            "stockfish-windows-x86-64-bmi2.exe",
            "stockfish-windows-x86-64-avx2.exe",
            "stockfish-windows-x86-64-sse41-popcnt.exe",
            "stockfish-windows-x86-64.exe",
        ].map((filename) => `${stockfishDir}\\${filename}`),
    );

    const ownLc0Dir = await resolve(enginesDir, "lc0-0.32.1-bt4-it332");
    const sharedLc0Dir = await resolve(localData, "ChessTrainer", "engines", "lc0-v0.32.1-fresh");
    const lc0Candidates = [ownLc0Dir, sharedLc0Dir];
    let lc0Path: string | null = null;
    let weightsPath: string | null = null;
    for (const directory of lc0Candidates) {
        const executable = `${directory}\\lc0.exe`;
        const weights = `${directory}\\BT4-it332.pb.gz`;
        if ((await firstExistingPath([executable])) && (await firstExistingPath([weights]))) {
            lc0Path = executable;
            weightsPath = weights;
            break;
        }
    }

    const installed: LocalEngine[] = [];
    if (stockfishPath) {
        installed.push({
            type: "local",
            id: MANAGED_STOCKFISH_ID,
            name: "Stockfish",
            version: "18",
            path: stockfishPath,
            loaded: true,
            go: { t: "Depth", c: 17 },
            settings: [
                { name: "MultiPV", value: 3 },
                { name: "Threads", value: 8 },
                { name: "Hash", value: 512 },
            ],
        });
    }
    if (lc0Path && weightsPath) {
        installed.push({
            type: "local",
            id: MANAGED_LC0_ID,
            name: "LCZero",
            version: "0.32.1",
            path: lc0Path,
            loaded: true,
            go: { t: "Depth", c: 14 },
            settings: [
                { name: "MultiPV", value: 3 },
                { name: "WeightsFile", value: weightsPath },
                { name: "MinibatchSize", value: 16 },
                { name: "NNCacheSize", value: 500000 },
            ],
        });
    }
    return installed;
}

export const CHESSBOT_LC0_ENGINE: LocalEngine = {
    type: "local",
    id: "catalog-lc0-0.32.1-bt4-it332",
    name: "LCZero",
    version: "0.32.1",
    path: "lc0-0.32.1-bt4-it332/lc0.exe",
    image: "https://lczero.org/images/logo.svg",
    elo: 3440,
    downloadSize: 581_970_338 + 382_645_315,
    managedInstall: "chessbot-lc0-0.32.1",
};

export function mergeManagedEngineCatalog(engines: LocalEngine[], os: Platform): LocalEngine[] {
    if (os !== "windows") return engines;
    const withoutStaleLc0 = engines.filter((engine) => {
        const name = engine.name.toLowerCase();
        const path = engine.path.toLowerCase();
        return !(
            name.includes("leela chess zero") ||
            name.includes("lczero") ||
            /(^|[\\/])lc0(?:-|[\\/.])/.test(path)
        );
    });
    return [...withoutStaleLc0, CHESSBOT_LC0_ENGINE];
}

const remoteEngineSchema = z.object({
    type: z.enum(["chessdb", "lichess"]),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    url: z.string(),
    image: z.string().nullish(),
    loaded: z.boolean().nullish(),
    enabled: z.boolean().nullish(),
    go: goModeSchema.nullish(),
    settings: engineSettingsSchema.nullish(),
});

export type RemoteEngine = z.output<typeof remoteEngineSchema>;

const pcEngineSchema = z.object({
    type: z.literal("pc"),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    url: z.string(),
    engineKind: z.enum(["stockfish", "lc0"]),
    image: z.string().nullish(),
    loaded: z.boolean().nullish(),
    enabled: z.boolean().nullish(),
    go: goModeSchema.nullish(),
    settings: engineSettingsSchema.nullish(),
});

export type PcEngine = z.output<typeof pcEngineSchema>;

export function createGamingPcLc0Engine(): PcEngine {
    return {
        type: "pc",
        id: "gaming-pc-lc0",
        name: "Gaming PC LC0",
        url: String(
            import.meta.env.VITE_EN_CROISSANT_STOCKFISH_URL ?? "http://127.0.0.1:38419",
        ).replace(/\/+$/, ""),
        engineKind: "lc0",
        loaded: true,
        go: { t: "Depth", c: 14 },
        settings: [
            { name: "MultiPV", value: 3 },
            { name: "Depth", value: 14 },
            { name: "AutoNetwork", value: true },
            { name: "OddsMode", value: "none" },
        ],
    };
}

export const engineSchema = z.union([localEngineSchema, remoteEngineSchema, pcEngineSchema]);
export type Engine = z.output<typeof engineSchema>;

export function stopEngine(engine: LocalEngine, tab: string): Promise<void> {
    return commands.stopEngine(engine.id, tab).then((r) => {
        unwrap(r);
    });
}

export function stopMatchingEngine(
    engine: LocalEngine,
    tab: string,
    goMode: GoMode,
    options: EngineOptions,
): Promise<void> {
    return commands.stopMatchingEngine(engine.id, tab, goMode, options).then((r) => {
        unwrap(r);
    });
}

export function killEngine(engine: LocalEngine, tab: string): Promise<void> {
    return commands.killEngine(engine.id, tab).then((r) => {
        unwrap(r);
    });
}

export function getBestMoves(
    engine: LocalEngine,
    tab: string,
    goMode: GoMode,
    options: EngineOptions,
): Promise<[number, BestMoves[]] | null> {
    return commands
        .getBestMoves(engine.id, engine.path, tab, goMode, options)
        .then((r) => unwrap(r));
}

export function useDefaultEngines(os: Platform | undefined, opened: boolean) {
    const { data, error, isLoading } = useSWR(opened ? os : null, async (os: Platform) => {
        const bmi2: boolean = await commands.isBmi2Compatible();
        const data = await fetch(`https://www.encroissant.org/engines?os=${os}&bmi2=${bmi2}`, {
            method: "GET",
        });
        if (!data.ok) {
            throw new Error("Failed to fetch engines");
        }
        const engines = (await data.json()).filter(
            (e: { os: Platform; bmi2: boolean }) => e.os === os && e.bmi2 === bmi2,
        );
        return mergeManagedEngineCatalog(engines, os);
    });
    return {
        defaultEngines: data as LocalEngine[],
        error,
        isLoading,
    };
}
