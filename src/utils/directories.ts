import { appDataDir, documentDir, homeDir, resolve } from "@tauri-apps/api/path";
import { exists, mkdir, readDir } from "@tauri-apps/plugin-fs";
import {
    chooseDocumentDirectoryPath,
    readStoredDirectoryOverride,
} from "@/utils/directoryOverrides";

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
    try {
        const storedDir = readStoredDirectoryOverride("document-dir");
        const platformDir = await resolve(await documentDir(), "EnCroissant");
        const localDocumentsDir = await resolve(await homeDir(), "Documents", "EnCroissant");
        const populatedPaths = new Set<string>();

        for (const candidate of new Set([platformDir, localDocumentsDir])) {
            if ((await exists(candidate)) && (await readDir(candidate)).length > 0) {
                populatedPaths.add(candidate.replaceAll("\\", "/").toLowerCase().replace(/\/$/, ""));
            }
        }

        return ensureDirectory(
            chooseDocumentDirectoryPath({
                storedPath: storedDir,
                platformPath: platformDir,
                localDocumentsPath: localDocumentsDir,
                populatedPaths,
            }),
        );
    } catch {
        return ensureDirectory(await resolve(await homeDir(), "Documents", "EnCroissant"));
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
