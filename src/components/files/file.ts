import { basename, join } from "@tauri-apps/api/path";
import { type DirEntry, exists, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { commands } from "@/bindings";
import { unwrap } from "@/utils/unwrap";

const pgnFileTypeSchema = z.enum(["repertoire", "game", "tournament", "puzzle", "other"]);
const fileTypeSchema = z.enum(["repertoire", "game", "tournament", "puzzle", "other", "pdf"]);

export type FileType = z.infer<typeof fileTypeSchema>;
export type PgnFileType = z.infer<typeof pgnFileTypeSchema>;

const fileInfoMetadataSchema = z.object({
    type: fileTypeSchema,
    tags: z.array(z.string()),
});

export type FileInfoMetadata = z.infer<typeof fileInfoMetadataSchema>;

export const fileMetadataSchema = z.object({
    type: z.literal("file"),
    name: z.string(),
    path: z.string(),
    extension: z.enum(["pgn", "pdf"]).optional(),
    numGames: z.number(),
    numGamesKnown: z.boolean().optional(),
    metadata: fileInfoMetadataSchema,
    lastModified: z.number(),
});

export type FileMetadata = z.infer<typeof fileMetadataSchema>;

export type FileData = {
    metadata: FileInfoMetadata;
    games: string[];
};

const HIDDEN_REPORT_ARTIFACT_DIRECTORIES = new Set([
    "report-render",
    "report-render-pdf",
    "report-print-pages",
    "source-pgns",
]);

function isHiddenReportArtifactDirectory(name: string) {
    return HIDDEN_REPORT_ARTIFACT_DIRECTORIES.has(name.toLowerCase());
}

async function readFileMetadata(path: string): Promise<FileMetadata | null> {
    const lowerPath = path.toLowerCase();
    const isPgn = lowerPath.endsWith(".pgn");
    const isPdf = lowerPath.endsWith(".pdf");

    if (!isPgn && !isPdf) {
        return null;
    }

    const fileMetadata = unwrap(await commands.getFileMetadata(path));
    const filename = await basename(path);

    if (isPdf) {
        return {
            type: "file",
            path,
            extension: "pdf",
            name: filename.replace(/\.pdf$/i, ""),
            numGames: 0,
            numGamesKnown: true,
            metadata: {
                type: "pdf",
                tags: [],
            },
            lastModified: fileMetadata.last_modified,
        };
    }

    const metadataPath = path.replace(".pgn", ".info");
    let metadata: FileInfoMetadata;
    if (await exists(metadataPath)) {
        metadata = JSON.parse(await readTextFile(metadataPath));
    } else {
        metadata = {
            type: "other",
            tags: [],
        };
        await writeTextFile(metadataPath, JSON.stringify(metadata));
    }
    return {
        type: "file",
        path,
        extension: "pgn",
        name: filename.replace(/\.pgn$/i, ""),
        // Counting every PGN blocks the whole Files page for large linked folders.
        // Resolve the exact count only when the user selects or opens the file.
        numGames: 1,
        numGamesKnown: false,
        metadata,
        lastModified: fileMetadata.last_modified,
    };
}

export function isPdfFile(file: FileMetadata) {
    return file.extension === "pdf" || file.path.toLowerCase().endsWith(".pdf");
}

export function isPgnFile(file: FileMetadata) {
    return !isPdfFile(file);
}

export function getFileExtension(file: FileMetadata) {
    return isPdfFile(file) ? "pdf" : "pgn";
}

export function stripSupportedFileExtension(name: string) {
    return name.replace(/\.(pgn|pdf)$/i, "");
}

export type Directory = {
    type: "directory";
    children: (FileMetadata | Directory)[];
    childrenLoaded?: boolean;
    path: string;
    name: string;
    lastModified: number;
};

export type Entry = FileMetadata | Directory;

async function processEntries(parent: string, entries: DirEntry[], recursive: boolean) {
    const processedEntries = await Promise.all(
        entries
            .filter((entry) => !entry.isDirectory || !isHiddenReportArtifactDirectory(entry.name))
            .map(async (entry) => {
                if (entry.isFile) {
                    return await readFileMetadata(await join(parent, entry.name));
                }
                if (entry.isDirectory) {
                    const dir = await join(parent, entry.name);
                    const children = recursive
                        ? await readDirectoryEntries(dir, { recursive: true })
                        : [];
                    const metadata = unwrap(await commands.getFileMetadata(dir));
                    const directory: Directory = {
                        type: "directory",
                        name: entry.name,
                        path: dir,
                        children,
                        childrenLoaded: recursive,
                        lastModified: metadata.last_modified,
                    };
                    return directory;
                }
                return null;
            }),
    );

    return processedEntries.filter((entry): entry is Entry => entry !== null);
}

export async function readDirectoryEntries(
    dir: string,
    options: { recursive?: boolean } = {},
): Promise<Entry[]> {
    const entries = await readDir(dir);
    return processEntries(dir, entries, options.recursive ?? false);
}

export async function processEntriesRecursively(parent: string, entries: DirEntry[]) {
    return processEntries(parent, entries, true);
}
