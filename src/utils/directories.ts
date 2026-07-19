import { appDataDir, documentDir, homeDir, resolve } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { readStoredDirectoryOverride } from "@/utils/directoryOverrides";

async function ensureDirectory(path: string): Promise<string> {
    if (!(await exists(path))) {
        await mkdir(path, { recursive: true });
    }
    return path;
}

export async function getDatabasesDir(): Promise<string> {
    const customDir = readStoredDirectoryOverride("databases-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "db"));
}

export async function getDocumentDir(): Promise<string> {
    const customDir = readStoredDirectoryOverride("document-dir");
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
    const customDir = readStoredDirectoryOverride("engines-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "engines"));
}

export async function getPuzzlesDir(): Promise<string> {
    const customDir = readStoredDirectoryOverride("puzzles-dir");
    if (customDir) {
        return ensureDirectory(customDir);
    }

    return ensureDirectory(await resolve(await appDataDir(), "puzzles"));
}
