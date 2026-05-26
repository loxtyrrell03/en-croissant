import { resolve, tempDir } from "@tauri-apps/api/path";
import {
    copyFile,
    exists,
    mkdir,
    readDir,
    readTextFile,
    remove,
    writeTextFile,
} from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings";
import type { DatabaseLinkedFolderRecord, DatabaseLinkedFolderRecords } from "@/state/atoms";
import { unwrap } from "./unwrap";

const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]/;
const GAME_FILE_METADATA = '{"type":"game","tags":[]}';

export function removeDatabaseExtension(name: string) {
    return name.replace(/\.pgn\.(zst|bz2)$/i, "").replace(/\.(pgn|db3|zst|bz2)$/i, "");
}

export function isSqliteDatabase(path: string) {
    return path.toLowerCase().endsWith(".db3");
}

export function getGameFileCountText(count: number) {
    return count === 1 ? "1 game file" : `${count} game files`;
}

export function getDefaultDatabaseFolderName(name: string) {
    const cleaned = removeDatabaseExtension(name)
        .replace(INVALID_FOLDER_CHARS, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Exported database";
}

export function validateDatabaseFilesFolderName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
        return "Folder name is required.";
    }

    if (trimmed === "." || trimmed === ".." || INVALID_FOLDER_CHARS.test(trimmed)) {
        return "Folder name cannot contain path separators or reserved filename characters.";
    }

    return "";
}

export async function splitGameSourceToFiles({
    sourcePath,
    targetDir,
    fileType = "game",
}: {
    sourcePath: string;
    targetDir: string;
    fileType?: string;
}) {
    let splitSourcePath = sourcePath;
    let temporaryExportPath: string | null = null;

    try {
        if (isSqliteDatabase(sourcePath)) {
            temporaryExportPath = await resolve(
                await tempDir(),
                `split_database_${Date.now()}_${Math.random().toString(36).slice(2)}.pgn`,
            );
            unwrap(await commands.exportToPgn(sourcePath, temporaryExportPath));
            splitSourcePath = temporaryExportPath;
        }

        return unwrap(await commands.splitPgnToFiles(splitSourcePath, targetDir, fileType));
    } finally {
        if (temporaryExportPath) {
            await remove(temporaryExportPath).catch(() => {});
        }
    }
}

export function getDatabaseLinkedFolderRecord(
    dbPath: string,
    records: DatabaseLinkedFolderRecords,
) {
    return records[dbPath] ?? null;
}

export function upsertDatabaseLinkedFolderRecord(
    records: DatabaseLinkedFolderRecords,
    record: DatabaseLinkedFolderRecord,
): DatabaseLinkedFolderRecords {
    return {
        ...records,
        [record.dbPath]: record,
    };
}

export function removeDatabaseLinkedFolderRecord(
    records: DatabaseLinkedFolderRecords,
    dbPath: string,
): DatabaseLinkedFolderRecords {
    if (!records[dbPath]) return records;
    const nextRecords = { ...records };
    delete nextRecords[dbPath];
    return nextRecords;
}

export type LinkedFolderSyncReport = {
    created: number;
    skipped: number;
    targetDir: string;
    syncedAt: number;
};

export async function syncDatabaseLinkedFolder({
    sourcePath,
    title,
    gameCount,
    record,
}: {
    sourcePath: string;
    title: string;
    gameCount: number | null;
    record: DatabaseLinkedFolderRecord;
}): Promise<{ report: LinkedFolderSyncReport; record: DatabaseLinkedFolderRecord }> {
    const targetDir = record.folderPath;
    const temporaryTargetDir = await resolve(
        await tempDir(),
        `linked_database_folder_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );

    await mkdir(targetDir, { recursive: true });

    try {
        await splitGameSourceToFiles({
            sourcePath,
            targetDir: temporaryTargetDir,
            fileType: "game",
        });

        const existingHashes = await readPgnContentHashes(targetDir);
        const splitEntries = (await readDir(temporaryTargetDir))
            .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".pgn"))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        let created = 0;
        let skipped = 0;

        for (const entry of splitEntries) {
            const sourceGamePath = await resolve(temporaryTargetDir, entry.name);
            const sourceGameText = await readTextFile(sourceGamePath);
            const hash = hashPgnContent(sourceGameText);

            if (existingHashes.has(hash)) {
                skipped += 1;
                continue;
            }

            const targetGamePath = await getAvailablePgnPath(targetDir, entry.name);
            await copyFile(sourceGamePath, targetGamePath);

            const sourceInfoPath = pgnInfoPath(sourceGamePath);
            const targetInfoPath = pgnInfoPath(targetGamePath);
            if (await exists(sourceInfoPath)) {
                await copyFile(sourceInfoPath, targetInfoPath);
            } else {
                await writeTextFile(targetInfoPath, GAME_FILE_METADATA);
            }

            existingHashes.add(hash);
            created += 1;
        }

        const syncedAt = Date.now();
        return {
            report: {
                created,
                skipped,
                targetDir,
                syncedAt,
            },
            record: {
                ...record,
                title,
                lastSyncedAt: syncedAt,
                lastCreated: created,
                lastKnownGameCount: gameCount,
            },
        };
    } finally {
        await remove(temporaryTargetDir, { recursive: true }).catch(() => {});
    }
}

async function readPgnContentHashes(targetDir: string) {
    const entries = await readDir(targetDir).catch(() => []);
    const hashes = new Set<string>();

    for (const entry of entries) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".pgn")) continue;
        try {
            const path = await resolve(targetDir, entry.name);
            hashes.add(hashPgnContent(await readTextFile(path)));
        } catch {
            // Ignore files that cannot be read so one broken sidecar does not block sync.
        }
    }

    return hashes;
}

async function getAvailablePgnPath(targetDir: string, fileName: string) {
    const safeName = fileName.toLowerCase().endsWith(".pgn") ? fileName : `${fileName}.pgn`;
    const stem = safeName.slice(0, -".pgn".length).trim() || "Game";
    let candidate = await resolve(targetDir, `${stem}.pgn`);
    if (!(await exists(candidate))) return candidate;

    for (let index = 2; index < 10000; index += 1) {
        candidate = await resolve(targetDir, `${stem} ${index}.pgn`);
        if (!(await exists(candidate))) return candidate;
    }

    return await resolve(targetDir, `${stem} ${Date.now()}.pgn`);
}

function pgnInfoPath(filePath: string) {
    return `${filePath.slice(0, -".pgn".length)}.info`;
}

function hashPgnContent(input: string) {
    const normalized = input.replace(/\r\n/g, "\n").trim();
    let hash = 5381;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 33) ^ normalized.charCodeAt(index);
    }
    return `${normalized.length}:${hash >>> 0}`;
}
