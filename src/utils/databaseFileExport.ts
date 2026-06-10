import { resolve, tempDir } from "@tauri-apps/api/path";
import {
    copyFile,
    exists,
    mkdir,
    readDir,
    readTextFile,
    remove,
    rename,
    writeTextFile,
} from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings";
import type { DatabaseLinkedFolderRecord, DatabaseLinkedFolderRecords } from "@/state/atoms";
import { unwrap } from "./unwrap";

const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]/;
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;
const GAME_FILE_METADATA = '{"type":"game","tags":[]}';

type ExistingPgnEntry = {
    path: string;
    contentHash: string;
    mainlineHash: string;
    annotationScore: number;
};

type ExistingPgnIndex = {
    entriesByPath: Map<string, ExistingPgnEntry>;
    contentHashes: Map<string, ExistingPgnEntry[]>;
    mainlineHashes: Map<string, ExistingPgnEntry[]>;
};

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
    orderedFilenames = false,
}: {
    sourcePath: string;
    targetDir: string;
    fileType?: string;
    orderedFilenames?: boolean;
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

        return unwrap(
            await commands.splitPgnToFiles(
                splitSourcePath,
                targetDir,
                orderedFilenames ? "ordered-game" : fileType,
            ),
        );
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
    fileNamePrefix,
    orderedFilenames = false,
}: {
    sourcePath: string;
    title: string;
    gameCount: number | null;
    record: DatabaseLinkedFolderRecord;
    fileNamePrefix?: string | null;
    orderedFilenames?: boolean;
}): Promise<{ report: LinkedFolderSyncReport; record: DatabaseLinkedFolderRecord }> {
    const targetDir = record.folderPath;
    const temporaryTargetDir = await resolve(
        await tempDir(),
        `linked_database_folder_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );

    await mkdir(targetDir, { recursive: true });

    try {
        await prefixExistingPgnFiles(targetDir, fileNamePrefix);

        await splitGameSourceToFiles({
            sourcePath,
            targetDir: temporaryTargetDir,
            fileType: "game",
            orderedFilenames,
        });

        const existingIndex = await readExistingPgnIndex(targetDir);
        const splitEntries = (await readDir(temporaryTargetDir))
            .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".pgn"))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        let created = 0;
        let skipped = 0;

        for (const entry of splitEntries) {
            const sourceGamePath = await resolve(temporaryTargetDir, entry.name);
            const sourceGameText = await readTextFile(sourceGamePath);
            const hash = hashPgnContent(sourceGameText);
            const mainlineHash = orderedFilenames ? hashPgnMainline(sourceGameText) : null;
            const targetFileName = getPrefixedPgnFileName(entry.name, fileNamePrefix);
            const existingEntry = findReusablePgnEntry(existingIndex, {
                contentHash: hash,
                mainlineHash,
                targetFileName,
            });

            if (existingEntry) {
                if (orderedFilenames) {
                    if (mainlineHash) {
                        const duplicatePaths = getDuplicatePgnPathsForMainline(
                            existingIndex,
                            mainlineHash,
                            existingEntry.path,
                        );
                        await removeExistingPgnFiles(duplicatePaths);
                        for (const duplicatePath of duplicatePaths) {
                            removeExistingPgnIndexPath(existingIndex, duplicatePath);
                        }
                    }

                    const renamedPath = await renameExistingPgnToTargetName(
                        existingEntry.path,
                        targetDir,
                        targetFileName,
                    );
                    removeExistingPgnIndexPath(existingIndex, existingEntry.path);
                    addExistingPgnIndexEntry(existingIndex, {
                        ...existingEntry,
                        path: renamedPath,
                    });
                }
                skipped += 1;
                continue;
            }

            const targetGamePath = await getAvailablePgnPath(targetDir, targetFileName);
            await copyFile(sourceGamePath, targetGamePath);

            const sourceInfoPath = pgnInfoPath(sourceGamePath);
            const targetInfoPath = pgnInfoPath(targetGamePath);
            if (await exists(sourceInfoPath)) {
                await copyFile(sourceInfoPath, targetInfoPath);
            } else {
                await writeTextFile(targetInfoPath, GAME_FILE_METADATA);
            }

            addExistingPgnIndexEntry(existingIndex, {
                path: targetGamePath,
                contentHash: hash,
                mainlineHash: hashPgnMainline(sourceGameText),
                annotationScore: getPgnAnnotationScore(sourceGameText),
            });
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

async function readExistingPgnIndex(targetDir: string): Promise<ExistingPgnIndex> {
    const entries = await readDir(targetDir).catch(() => []);
    const index: ExistingPgnIndex = {
        entriesByPath: new Map(),
        contentHashes: new Map(),
        mainlineHashes: new Map(),
    };

    for (const entry of entries) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".pgn")) continue;
        try {
            const path = await resolve(targetDir, entry.name);
            const text = await readTextFile(path);
            addExistingPgnIndexEntry(index, {
                path,
                contentHash: hashPgnContent(text),
                mainlineHash: hashPgnMainline(text),
                annotationScore: getPgnAnnotationScore(text),
            });
        } catch {
            // Ignore files that cannot be read so one broken sidecar does not block sync.
        }
    }

    return index;
}

function addExistingPgnIndexEntry(index: ExistingPgnIndex, entry: ExistingPgnEntry) {
    index.entriesByPath.set(entry.path, entry);
    appendIndexEntry(index.contentHashes, entry.contentHash, entry);
    appendIndexEntry(index.mainlineHashes, entry.mainlineHash, entry);
}

function appendIndexEntry(
    map: Map<string, ExistingPgnEntry[]>,
    key: string,
    entry: ExistingPgnEntry,
) {
    const entries = map.get(key) ?? [];
    if (!entries.some((candidate) => candidate.path === entry.path)) {
        entries.push(entry);
    }
    map.set(key, entries);
}

function removeExistingPgnIndexPath(index: ExistingPgnIndex, path: string) {
    const entry = index.entriesByPath.get(path);
    if (!entry) return;

    index.entriesByPath.delete(path);
    removeIndexEntry(index.contentHashes, entry.contentHash, path);
    removeIndexEntry(index.mainlineHashes, entry.mainlineHash, path);
}

function removeIndexEntry(map: Map<string, ExistingPgnEntry[]>, key: string, path: string) {
    const entries = map.get(key);
    if (!entries) return;

    const nextEntries = entries.filter((entry) => entry.path !== path);
    if (nextEntries.length > 0) {
        map.set(key, nextEntries);
    } else {
        map.delete(key);
    }
}

function findReusablePgnEntry(
    index: ExistingPgnIndex,
    {
        contentHash,
        mainlineHash,
        targetFileName,
    }: {
        contentHash: string;
        mainlineHash: string | null;
        targetFileName: string;
    },
) {
    const candidatesByPath = new Map<string, ExistingPgnEntry>();
    for (const entry of index.contentHashes.get(contentHash) ?? []) {
        candidatesByPath.set(entry.path, entry);
    }
    if (mainlineHash) {
        for (const entry of index.mainlineHashes.get(mainlineHash) ?? []) {
            candidatesByPath.set(entry.path, entry);
        }
    }

    return Array.from(candidatesByPath.values()).sort((a, b) =>
        compareReusablePgnEntries(a, b, targetFileName),
    )[0];
}

function compareReusablePgnEntries(
    a: ExistingPgnEntry,
    b: ExistingPgnEntry,
    targetFileName: string,
) {
    return (
        b.annotationScore - a.annotationScore ||
        Number(getPathFileName(b.path) === targetFileName) -
            Number(getPathFileName(a.path) === targetFileName) ||
        getPathFileName(a.path).localeCompare(getPathFileName(b.path), undefined, {
            numeric: true,
        })
    );
}

function getDuplicatePgnPathsForMainline(
    index: ExistingPgnIndex,
    mainlineHash: string,
    keepPath: string,
) {
    return (index.mainlineHashes.get(mainlineHash) ?? [])
        .map((entry) => entry.path)
        .filter((path) => path !== keepPath);
}

async function removeExistingPgnFiles(paths: string[]) {
    for (const path of paths) {
        await remove(path).catch(() => {});

        const infoPath = pgnInfoPath(path);
        if (await exists(infoPath)) {
            await remove(infoPath).catch(() => {});
        }
    }
}

async function renameExistingPgnToTargetName(
    existingPath: string,
    targetDir: string,
    targetFileName: string,
) {
    if (getPathFileName(existingPath) === targetFileName) {
        return existingPath;
    }

    const targetPath = await getAvailablePgnPath(targetDir, targetFileName);
    if (targetPath === existingPath) {
        return existingPath;
    }

    await rename(existingPath, targetPath);

    const sourceInfoPath = pgnInfoPath(existingPath);
    if (await exists(sourceInfoPath)) {
        await rename(sourceInfoPath, pgnInfoPath(targetPath));
    }

    return targetPath;
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

async function prefixExistingPgnFiles(targetDir: string, prefix?: string | null) {
    const cleanPrefix = sanitizeFileNameStem(prefix ?? "");
    if (!cleanPrefix) return;

    const entries = (await readDir(targetDir).catch(() => []))
        .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".pgn"))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
        const targetName = getPrefixedPgnFileName(entry.name, cleanPrefix);
        if (targetName === entry.name) continue;

        const sourcePath = await resolve(targetDir, entry.name);
        const targetPath = await getAvailablePgnPath(targetDir, targetName);
        await rename(sourcePath, targetPath);

        const sourceInfoPath = pgnInfoPath(sourcePath);
        if (await exists(sourceInfoPath)) {
            await rename(sourceInfoPath, pgnInfoPath(targetPath));
        }
    }
}

function getPrefixedPgnFileName(fileName: string, prefix?: string | null) {
    const safeName = fileName.toLowerCase().endsWith(".pgn") ? fileName : `${fileName}.pgn`;
    const cleanPrefix = sanitizeFileNameStem(prefix ?? "");
    if (!cleanPrefix) return safeName;

    const stem = safeName.slice(0, -".pgn".length).trim() || "Game";
    if (stem.toLowerCase().includes(cleanPrefix.toLowerCase())) {
        return safeName;
    }

    return `${cleanPrefix} ${stem}.pgn`;
}

function sanitizeFileNameStem(value: string) {
    return value
        .replace(INVALID_FILENAME_CHARS, " ")
        .replace(/\s+/g, " ")
        .replace(/[. ]+$/g, "")
        .trim();
}

function pgnInfoPath(filePath: string) {
    return `${filePath.slice(0, -".pgn".length)}.info`;
}

function getPathFileName(filePath: string) {
    return filePath.split(/[\\/]/).pop() ?? filePath;
}

function hashPgnContent(input: string) {
    const normalized = input.replace(/\r\n/g, "\n").trim();
    let hash = 5381;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 33) ^ normalized.charCodeAt(index);
    }
    return `${normalized.length}:${hash >>> 0}`;
}

function hashPgnMainline(input: string) {
    return hashPgnContent(stripPgnCommentsAndVariations(getPgnMovetext(input)));
}

function getPgnAnnotationScore(input: string) {
    const movetext = getPgnMovetext(input);
    const commentCount = (movetext.match(/\{/g) ?? []).length;
    const variationCount = (movetext.match(/\(/g) ?? []).length;
    const nagCount = (movetext.match(/\$\d+|[!?]/g) ?? []).length;
    return commentCount * 100_000 + variationCount * 20_000 + nagCount * 1_000 + movetext.length;
}

function getPgnMovetext(input: string) {
    const lines = input.replace(/\r\n/g, "\n").split("\n");
    const movetext: string[] = [];
    let inHeaders = true;

    for (const line of lines) {
        if (inHeaders && line.startsWith("[")) continue;
        if (inHeaders && !line.trim()) {
            inHeaders = false;
            continue;
        }

        inHeaders = false;
        movetext.push(line);
    }

    return movetext.join("\n").trim();
}

function stripPgnCommentsAndVariations(input: string) {
    let output = "";
    let braceDepth = 0;
    let parenDepth = 0;
    let inLineComment = false;

    for (const char of input) {
        if (inLineComment) {
            if (char === "\n" || char === "\r") {
                inLineComment = false;
                output += " ";
            }
            continue;
        }
        if (braceDepth > 0) {
            if (char === "}") braceDepth -= 1;
            continue;
        }
        if (parenDepth > 0) {
            if (char === "(") parenDepth += 1;
            if (char === ")") parenDepth -= 1;
            continue;
        }

        if (char === ";") {
            inLineComment = true;
            continue;
        }
        if (char === "{") {
            braceDepth = 1;
            continue;
        }
        if (char === "(") {
            parenDepth = 1;
            continue;
        }

        output += char;
    }

    return output
        .replace(/\$\d+|[!?]+/g, " ")
        .replace(/\b\d+\.(?:\.\.)?/g, " ")
        .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export const __databaseFileExportTestUtils = {
    hashPgnMainline,
    getPgnAnnotationScore,
    createExistingPgnIndex(entries: ExistingPgnEntry[]) {
        const index: ExistingPgnIndex = {
            entriesByPath: new Map(),
            contentHashes: new Map(),
            mainlineHashes: new Map(),
        };
        for (const entry of entries) {
            addExistingPgnIndexEntry(index, entry);
        }
        return index;
    },
    findReusablePgnEntry,
    getDuplicatePgnPathsForMainline,
};
