import { Result } from "@badrap/result";
import { resolve } from "@tauri-apps/api/path";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import { platform } from "@tauri-apps/plugin-os";
import { defaultGame, makePgn } from "chessops/pgn";
import { getDefaultStore } from "jotai";
import useSWR from "swr";
import { commands } from "@/bindings";
import type { FileMetadata, PgnFileType } from "@/components/files/file";
import { addRecentFileAtom, tabFamily } from "@/state/atoms";
import { unwrap } from "@/utils/unwrap";
import { parsePGN } from "./chess";
import { hydrateOnlinePgnClocks } from "./onlinePgnClocks";
import { createTab, isInTempDir, type Tab } from "./tabs";
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
    },
) {
    const store = getDefaultStore();
    const gameNumber = options?.gameNumber ?? 0;
    let fileInfo: FileMetadata;
    let isTempOrigin = false;
    let pgn = options?.pgn;
    let tabName = "Untitled";
    let recentName = "Untitled";
    let initialState: TreeState | undefined;

    async function hydrateFilePgn(filePath: string, gameIndex: number, rawPgn: string) {
        try {
            const hydrated = await hydrateOnlinePgnClocks(rawPgn);
            if (hydrated !== rawPgn) {
                await commands.writeGame(filePath, gameIndex, hydrated);
            }
            return hydrated;
        } catch (error) {
            warn(`Could not hydrate online PGN clocks: ${error}`);
            return rawPgn;
        }
    }

    if (typeof file === "string") {
        const count = unwrap(await commands.countPgnGames(file));
        isTempOrigin = await isInTempDir(file);
        if (pgn === undefined) {
            pgn = unwrap(await commands.readGames(file, gameNumber, gameNumber))[0];
        }
        if (pgn) {
            pgn = await hydrateFilePgn(file, gameNumber, pgn);
        }

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
            initialState = await parsePGN(pgn);
            tabName = getGameName(initialState.headers);
            recentName = tabName;
        } else {
            tabName = file;
            recentName = file;
        }
    } else {
        const count =
            file.numGamesKnown === false
                ? unwrap(await commands.countPgnGames(file.path))
                : file.numGames;
        fileInfo = {
            ...file,
            numGames: count,
            numGamesKnown: true,
        };
        isTempOrigin = await isInTempDir(file.path);
        if (pgn === undefined) {
            pgn = unwrap(await commands.readGames(file.path, gameNumber, gameNumber))[0];
        }
        if (pgn) {
            pgn = await hydrateFilePgn(file.path, gameNumber, pgn);
        }
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
    await writeTextFile(file, pgn || makePgn(defaultGame()));
    await writeTextFile(file.replace(".pgn", ".info"), JSON.stringify(metadata));
    const numGames = unwrap(await commands.countPgnGames(file));
    return Result.ok({
        type: "file",
        name: filename,
        path: file,
        extension: "pgn",
        numGames,
        numGamesKnown: true,
        metadata,
        lastModified: new Date().getUTCSeconds(),
    });
}
