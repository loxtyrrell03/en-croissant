import { Result } from "@badrap/result";
import { resolve } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import { platform } from "@tauri-apps/plugin-os";
import { defaultGame, makePgn } from "chessops/pgn";
import { getDefaultStore } from "jotai";
import useSWR from "swr";
import { pgnFiles } from "@/bindings/pgnFiles";
import type { FileMetadata, PgnFileType } from "@/components/files/file";
import { addRecentFileAtom, tabFamily } from "@/state/atoms";
import { parsePGN } from "./chess";
import { hydrateOnlinePgnClocks } from "./onlinePgnClocks";
import { createTab, isInTempDir, normalizeSourcePgn, type Tab } from "./tabs";
import { getGameName, type TreeState } from "./treeReducer";

export function usePlatform() {
    const r = useSWR("os", async () => {
        return platform();
    });
    return { os: r.data, ...r };
}

export async function openFile(
    file: string | FileMetadata,
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>,
    options?: {
        gameNumber?: number;
        pgn?: string;
        expectedIdentity?: string;
    },
) {
    const store = getDefaultStore();
    const gameNumber = options?.gameNumber ?? 0;
    let fileInfo: FileMetadata;
    let isTempOrigin = false;
    let pgn: string;
    let tabName = "Untitled";
    let recentName = "Untitled";
    let initialState: TreeState | undefined;

    async function hydrateFilePgn(rawPgn: string) {
        try {
            const hydrated = await hydrateOnlinePgnClocks(rawPgn);
            return hydrated;
        } catch (error) {
            warn(`Could not hydrate online PGN clocks: ${error}`);
            return rawPgn;
        }
    }

    const path = typeof file === "string" ? file : file.path;
    const captured = await pgnFiles.read(path, gameNumber);
    if (
        (options?.expectedIdentity && captured.identity !== options.expectedIdentity) ||
        (options?.pgn !== undefined &&
            normalizeSourcePgn(options.pgn) !== normalizeSourcePgn(captured.pgn))
    )
        throw new Error(
            "The PGN changed while opening it. Refresh the game list and open it again.",
        );
    pgn = await hydrateFilePgn(captured.pgn);
    initialState = await parsePGN(pgn);
    if (pgn !== captured.pgn) initialState.dirty = true;

    if (typeof file === "string") {
        const count = captured.gameCount;
        isTempOrigin = await isInTempDir(file);

        fileInfo = {
            type: "file" as const,
            metadata: {
                tags: [],
                type: "game" as const,
            },
            name: file,
            path: file,
            extension: "pgn",
            numGames: count,
            lastModified: new Date().getUTCSeconds(),
        };

        if (pgn) {
            tabName = getGameName(initialState.headers);
            recentName = tabName;
        } else {
            tabName = file;
            recentName = file;
        }
    } else {
        const count = captured.gameCount;
        fileInfo = {
            ...file,
            numGames: count,
            numGamesKnown: true,
        };
        isTempOrigin = await isInTempDir(file.path);
        tabName = file.name || "Untitled";
        recentName = tabName;
    }

    const id = await createTab({
        tab: {
            name: tabName,
            type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: pgn || "",
        initialState,
        gameOrigin: {
            kind: isTempOrigin ? "temp_file" : "file",
            file: fileInfo,
            gameNumber,
            sourceIdentity: captured.identity,
        },
    });

    if (fileInfo.metadata.type === "repertoire") {
        store.set(tabFamily(id), "practice");
    }

    if (fileInfo.metadata.type !== "pdf") {
        store.set(addRecentFileAtom, {
            name: recentName,
            path: fileInfo.path,
            type: fileInfo.metadata.type,
        });
    }

    return id;
}

export async function createFile({
    filename,
    filetype,
    pgn,
    dir,
}: {
    filename: string;
    filetype: PgnFileType;
    pgn?: string;
    dir: string;
}): Promise<Result<FileMetadata>> {
    const file = await resolve(dir, `${filename}.pgn`);
    if (await exists(file)) {
        return Result.err(Error("File already exists"));
    }
    const metadata = {
        type: filetype,
        tags: [],
    };
    const created = await pgnFiles.create(
        file,
        pgn || makePgn(defaultGame()),
        JSON.stringify(metadata),
    );
    const actualName =
        created.file
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/\.pgn$/i, "") ?? filename;
    return Result.ok({
        type: "file",
        name: actualName,
        path: created.file,
        extension: "pgn",
        numGames: created.gameCount,
        numGamesKnown: true,
        metadata,
        lastModified: new Date().getUTCSeconds(),
    });
}
