import { appDataDir, documentDir, homeDir, resolve } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";

export function isLeakedOutpostVerificationDatabaseDir(path: string): boolean {
    const normalized = path.replaceAll("/", "\\").toLowerCase().replace(/\\+$/, "");
    const isTemporary = normalized.includes("\\appdata\\local\\temp\\");
    const isParityHarness =
        normalized.includes("\\outpost-fork-parity-") ||
        normalized.includes("\\outpost-parity-");
    return isTemporary && isParityHarness && normalized.endsWith("\\db");
}

export function getStoredDirectory(key: string): string | null {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    try {
        const parsed = JSON.parse(stored);
        if (typeof parsed !== "string" || parsed.length === 0) return null;
        if (key === "databases-dir" && isLeakedOutpostVerificationDatabaseDir(parsed)) {
            localStorage.removeItem(key);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function ensureDirectory(path: string): Promise<string> {
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
    return path;
}

export async function getDatabasesDir(): Promise<string> {
    const customDir = getStoredDirectory("databases-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "db"));
}

export async function getDocumentDir(): Promise<string> {
    const customDir = getStoredDirectory("document-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    try {
        return ensureDirectory(await resolve(await documentDir(), "EnCroissant"));
    } catch {
        return ensureDirectory(await resolve(await homeDir(), "EnCroissant"));
    }
}

export async function getEnginesDir(): Promise<string> {
    const customDir = getStoredDirectory("engines-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "engines"));
}

export async function getPuzzlesDir(): Promise<string> {
    const customDir = getStoredDirectory("puzzles-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "puzzles"));
}
