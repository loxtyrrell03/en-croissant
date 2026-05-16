import { resolve, tempDir } from "@tauri-apps/api/path";
import { remove } from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings";
import { unwrap } from "./unwrap";

const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]/;

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
