import { join, resolve } from "@tauri-apps/api/path";
import { exists, readDir } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import useSWR from "swr";
import {
    commands,
    type DatabaseInfo,
    type GameQuery,
    type NormalizedGame,
    type PlanExplorerData,
    type Player,
    type PlayerQuery,
    type PuzzleDatabaseInfo,
    type QueryResponse,
} from "@/bindings";
import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
import { getDatabasesDir } from "@/utils/directories";
import { unwrap } from "./unwrap";

export type SuccessDatabaseInfo = Extract<DatabaseInfo, { type: "success" }>;
export type DatabaseSortMode = "folder" | "name" | "games" | "storage";

export type DatabaseFolderGroup = {
    path: string;
    label: string;
    databases: DatabaseInfo[];
};

export type Sides = "WhiteBlack" | "BlackWhite" | "Any";

export interface CompleteGame {
    game: NormalizedGame;
    currentMove: number[];
}

export type Speed =
    | "UltraBullet"
    | "Bullet"
    | "Blitz"
    | "Rapid"
    | "Classical"
    | "Correspondence"
    | "Unknown";

function normalizeRange(range?: [number, number] | null): [number, number] | undefined {
    if (!range || range[1] - range[0] === 3000) {
        return undefined;
    }
    return range;
}

export async function query_games(
    db: string,
    query: GameQuery,
): Promise<QueryResponse<NormalizedGame[]>> {
    return unwrap(
        await commands.getGames(db, {
            player1: query.player1,
            range1: normalizeRange(query.range1),
            player2: query.player2,
            range2: normalizeRange(query.range2),
            tournament_id: query.tournament_id,
            sides: query.sides,
            outcome: query.outcome,
            start_date: query.start_date,
            end_date: query.end_date,
            position: null,
            options: {
                skipCount: query.options?.skipCount ?? false,
                page: query.options?.page,
                pageSize: query.options?.pageSize,
                sort: query.options?.sort || "id",
                direction: query.options?.direction || "desc",
            },
        }),
    );
}

export async function query_players(
    db: string,
    query: PlayerQuery,
): Promise<QueryResponse<Player[]>> {
    return unwrap(
        await commands.getPlayers(db, {
            options: {
                skipCount: query.options.skipCount || false,
                page: query.options.page,
                pageSize: query.options.pageSize,
                sort: query.options.sort,
                direction: query.options.direction,
            },
            name: query.name,
            range: normalizeRange(query.range),
        }),
    );
}

export async function getMostCommonPlayer(db: string): Promise<Player | null> {
    let res;
    try {
        res = await commands.getMostCommonPlayer(db);
    } catch (error) {
        console.warn(error);
        return getMostCommonPlayerFromGames(db);
    }

    if (res.status === "error") {
        console.warn(res.error);
        return getMostCommonPlayerFromGames(db);
    }
    return res.data ?? getMostCommonPlayerFromGames(db);
}

async function getMostCommonPlayerFromGames(db: string): Promise<Player | null> {
    const pageSize = 1000;
    const counts = new Map<number, { player: Player; games: number }>();
    let page = 1;
    let total: number | null = null;

    do {
        const response = await query_games(db, {
            options: {
                page,
                pageSize,
                skipCount: page !== 1,
                sort: "id",
                direction: "desc",
            },
        });
        total ??= response.count ?? response.data.length;

        for (const game of response.data) {
            addCommonPlayerCandidate(counts, {
                id: game.white_id,
                name: game.white,
                elo: game.white_elo ?? null,
            });
            addCommonPlayerCandidate(counts, {
                id: game.black_id,
                name: game.black,
                elo: game.black_elo ?? null,
            });
        }

        if (response.data.length === 0) break;
        page += 1;
    } while ((page - 1) * pageSize < total);

    return getTopCommonPlayerCandidate(counts);
}

function addCommonPlayerCandidate(
    counts: Map<number, { player: Player; games: number }>,
    player: Player,
) {
    if (!player.id || !player.name || player.name === "Unknown") return;

    const current = counts.get(player.id);
    if (current) {
        current.games += 1;
        return;
    }

    counts.set(player.id, { player, games: 1 });
}

function getTopCommonPlayerCandidate(counts: Map<number, { player: Player; games: number }>) {
    return (
        Array.from(counts.values()).sort(
            (a, b) =>
                b.games - a.games ||
                (a.player.name ?? "").localeCompare(b.player.name ?? "", undefined, {
                    sensitivity: "base",
                }),
        )[0]?.player ?? null
    );
}

type DatabaseFileEntry = {
    path: string;
    folderSegments: string[];
    relativePath: string;
};

export async function getDatabases(): Promise<DatabaseInfo[]> {
    const dbDir = await getDatabasesDir();
    const dbs = await getDatabaseFiles(dbDir);
    return (await Promise.allSettled(dbs.map((db) => getDatabase(db))))
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<DatabaseInfo>).value);
}

export async function getDatabaseFolders(): Promise<string[]> {
    const dbDir = await getDatabasesDir();
    return getDatabaseFolderPaths(dbDir);
}

async function getDatabaseFolderPaths(
    directory: string,
    folderSegments: string[] = [],
): Promise<string[]> {
    const entries = await readDir(directory);
    const folders = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory)
            .map(async (entry) => {
                const segments = [...folderSegments, entry.name];
                const path = await join(directory, entry.name);
                return [segments.join("/"), ...(await getDatabaseFolderPaths(path, segments))];
            }),
    );
    return folders.flat().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function getDatabaseFiles(
    directory: string,
    folderSegments: string[] = [],
): Promise<DatabaseFileEntry[]> {
    const entries = await readDir(directory);
    const results = await Promise.all(
        entries.map(async (entry): Promise<DatabaseFileEntry[]> => {
            const path = await join(directory, entry.name);
            if (entry.isDirectory) {
                return getDatabaseFiles(path, [...folderSegments, entry.name]);
            }
            if (!entry.isFile || !entry.name.endsWith(".db3")) {
                return [];
            }
            return [
                {
                    path,
                    folderSegments,
                    relativePath: [...folderSegments, entry.name].join("/"),
                },
            ];
        }),
    );
    return results.flat();
}

async function getDatabase(entry: DatabaseFileEntry): Promise<DatabaseInfo> {
    const path = entry.path;
    const res = await commands.getDbInfo(path);
    const folder = entry.folderSegments.join("/");
    if (res.status === "ok") {
        return {
            type: "success",
            ...res.data,
            file: path,
            relativePath: entry.relativePath,
            folder,
            folderSegments: entry.folderSegments,
        };
    }
    return {
        type: "error",
        filename: entry.relativePath.split("/").at(-1) ?? path,
        file: path,
        relativePath: entry.relativePath,
        folder,
        folderSegments: entry.folderSegments,
        error: res.error,
        indexed: false,
    };
}

export function getDatabaseFolderPath(database: Pick<DatabaseInfo, "folder">) {
    return database.folder ?? "";
}

export function getDatabaseFolderLabel(folder: string) {
    return folder || "Unfiled";
}

export function getDatabaseDisplayTitle(database: DatabaseInfo) {
    return database.type === "success" ? database.title : database.error;
}

export function sortDatabases(databases: DatabaseInfo[], mode: DatabaseSortMode) {
    return [...databases].sort((a, b) => {
        const titleA = getDatabaseDisplayTitle(a);
        const titleB = getDatabaseDisplayTitle(b);
        if (mode === "games") {
            const games =
                (b.type === "success" ? b.game_count : -1) -
                (a.type === "success" ? a.game_count : -1);
            if (games !== 0) return games;
        }
        if (mode === "storage") {
            const storage =
                Number(b.type === "success" && b.storage_size !== undefined ? b.storage_size : 0) -
                Number(a.type === "success" && a.storage_size !== undefined ? a.storage_size : 0);
            if (storage !== 0) return storage;
        }
        if (mode === "folder") {
            const folder = getDatabaseFolderPath(a).localeCompare(
                getDatabaseFolderPath(b),
                undefined,
                {
                    sensitivity: "base",
                },
            );
            if (folder !== 0) return folder;
        }
        return titleA.localeCompare(titleB, undefined, { sensitivity: "base" });
    });
}

export function groupDatabasesByFolder(databases: DatabaseInfo[], mode: DatabaseSortMode) {
    const groups = new Map<string, DatabaseInfo[]>();
    for (const database of databases) {
        const folder = getDatabaseFolderPath(database);
        groups.set(folder, [...(groups.get(folder) ?? []), database]);
    }

    return Array.from(groups.entries())
        .map(
            ([path, items]): DatabaseFolderGroup => ({
                path,
                label: getDatabaseFolderLabel(path),
                databases: sortDatabases(items, mode),
            }),
        )
        .sort((a, b) => {
            if (a.path === "" && b.path !== "") return -1;
            if (a.path !== "" && b.path === "") return 1;
            return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
        });
}

export function getDatabaseFolderOptions(databases: DatabaseInfo[]) {
    return Array.from(
        new Set(databases.map((database) => getDatabaseFolderPath(database)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function getDatabaseSelectData(databases: DatabaseInfo[]) {
    return groupDatabasesByFolder(databases, "name")
        .map((group) => ({
            group: group.label,
            items: group.databases
                .filter((database) => database.type === "success")
                .map((database) => ({
                    value: database.file,
                    label: database.type === "success" ? database.title : database.filename,
                })),
        }))
        .filter((group) => group.items.length > 0);
}

export function validateDatabaseFolderPath(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "Choose a folder name.";
    const segments = trimmed.split(/[\\/]+/).map((segment) => segment.trim());
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        return "Folder names cannot be empty, '.', or '..'.";
    }
    if (segments.some((segment) => /[<>:"|?*]/.test(segment))) {
        return 'Folder names cannot contain < > : " | ? *.';
    }
    return null;
}

export function normalizeDatabaseFolderPath(value: string) {
    return value
        .trim()
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");
}

export async function resolveDatabaseFolderPath(databaseDir: string, folder: string) {
    const normalized = normalizeDatabaseFolderPath(folder);
    if (!normalized) return databaseDir;
    return resolve(databaseDir, ...normalized.split("/"));
}

async function getUniqueDatabasePath(directory: string, filename: string, currentPath: string) {
    const extension = ".db3";
    const base = filename.endsWith(extension) ? filename.slice(0, -extension.length) : filename;
    let candidate = await resolve(directory, filename);
    let suffix = 2;
    while (candidate !== currentPath && (await exists(candidate))) {
        candidate = await resolve(directory, `${base} (${suffix})${extension}`);
        suffix += 1;
    }
    return candidate;
}

export async function getDatabaseMoveTarget(
    database: DatabaseInfo,
    databaseDir: string,
    folder: string,
) {
    const targetDir = await resolveDatabaseFolderPath(databaseDir, folder);
    return getUniqueDatabasePath(targetDir, database.filename, database.file);
}

export async function moveDatabaseFile(source: string, target: string) {
    if (source === target) return;
    unwrap(await commands.moveDatabase(source, target));
}

export function getSuggestedDatabaseFolder(database: DatabaseInfo) {
    const title = database.type === "success" ? database.title : "";
    const haystack = [title, database.filename, database.relativePath ?? "", database.file]
        .join(" ")
        .toLowerCase();

    if (haystack.includes("muswell congress prep")) return "Opponent Prep/Muswell Congress";
    if (haystack.includes(" prep - ") || haystack.includes("opponent prep")) return "Opponent Prep";
    if (haystack.includes("repertoire")) return "Repertoires";
    if (haystack.includes("_chesscom") || haystack.includes("chess.com"))
        return "Online Games/Chess.com";
    if (haystack.includes("_lichess") || haystack.includes("lichess"))
        return "Online Games/Lichess";
    if (haystack.includes("study")) return "Studies";
    if (
        haystack.includes("mega database") ||
        haystack.includes("master games") ||
        haystack.includes("masters")
    ) {
        return "Reference";
    }
    if (haystack.includes("my ") || haystack.includes("classical games")) return "Personal";
    return "Imported";
}

export function useDefaultDatabases(opened: boolean) {
    const { data, error, isLoading } = useSWR(opened ? "default-dbs" : null, async () => {
        const data = await fetch("https://www.encroissant.org/databases", {
            method: "GET",
        });
        if (!data.ok) {
            throw new Error("Failed to fetch engines");
        }
        return (await data.json()) as SuccessDatabaseInfo[];
    });
    return {
        defaultDatabases: data,
        error,
        isLoading,
    };
}

export async function getDefaultPuzzleDatabases(): Promise<
    (PuzzleDatabaseInfo & { downloadLink: string })[]
> {
    const data = await fetch("https://www.encroissant.org/puzzle_databases", {
        method: "GET",
    });
    if (!data.ok) {
        throw new Error("Failed to fetch puzzle databases");
    }
    return (await data.json()) as (PuzzleDatabaseInfo & {
        downloadLink: string;
    })[];
}

export interface Opening {
    move: string;
    white: number;
    black: number;
    draw: number;
    lastPlayed?: string | null;
}

export type SearchPositionMode = {
    includeOpenings?: boolean;
    includeGames?: boolean;
    gameLimit?: number;
    query?: Partial<GameQuery>;
};

export type DatabaseResultPerspective = "white" | "black";

export async function getTournamentGames(file: string, id: number) {
    return await query_games(file, {
        options: {
            direction: "asc",
            sort: "id",
            skipCount: true,
        },
        tournament_id: id,
    });
}

export async function searchPosition(
    options: LocalOptions,
    tab: string,
    mode: SearchPositionMode = {},
) {
    const includeOpenings = mode.includeOpenings ?? true;
    const includeGames = mode.includeGames ?? true;
    const resolvedPlayer = await resolveLocalOptionsPlayer(options);
    const playerQuery = getLocalPlayerGameQuery(resolvedPlayer, options.color);
    const query: GameQuery = {
        ...playerQuery,
        position: {
            fen: options.fen,
            type_: options.type,
        },
        start_date: options.start_date,
        end_date: options.end_date,
        wanted_result: options.result,
        ...mode.query,
    };

    if (!includeOpenings || !includeGames || mode.gameLimit !== undefined) {
        query.options = {
            skipCount: !includeOpenings,
            page: null,
            pageSize: includeGames ? (mode.gameLimit ?? null) : 0,
            sort: "id",
            direction: "desc",
            ...query.options,
        };
    }

    const res = await commands.searchPosition(options.path!, query, tab);
    if (res.status === "error") {
        if (res.error !== "Search stopped") {
            unwrap(res);
        }
        return Promise.reject();
    }
    return res.data;
}

export async function cancelDatabaseSearch(id: string | null | undefined) {
    if (!id) return;
    await commands.cancelDatabaseSearch(id);
}

export async function setDatabaseSearchPaused(id: string | null | undefined, paused: boolean) {
    if (!id) return;
    await commands.setDatabaseSearchPaused(id, paused);
}

export async function getPlanExplorer(
    options: LocalOptions,
    maxPlies: number,
    requestId = "plan-explorer",
): Promise<PlanExplorerData> {
    const resolvedPlayer = await resolveLocalOptionsPlayer(options);
    const res = await commands.getPlanExplorer(
        options.path!,
        {
            ...getLocalPlayerGameQuery(resolvedPlayer, options.color),
            position: {
                fen: options.fen,
                type_: options.type,
            },
            start_date: options.start_date,
            end_date: options.end_date,
            wanted_result: options.result,
        },
        maxPlies,
        requestId,
    );
    if (res.status === "error" && res.error === "Search stopped") {
        return Promise.reject();
    }
    return unwrap(res);
}

export function getLocalResultPerspective(
    options: Pick<LocalOptions, "player" | "playerName" | "color">,
): DatabaseResultPerspective | null {
    return hasLocalPlayerPerspective(options) ? options.color : null;
}

export function hasLocalPlayerPerspective(options: Pick<LocalOptions, "player" | "playerName">) {
    return !!options.player || !!options.playerName?.trim();
}

async function resolveLocalOptionsPlayer(
    options: LocalOptions,
): Promise<number | null | undefined> {
    if (!options.path) return undefined;

    const playerName = options.playerName?.trim();
    if (!playerName) {
        return options.player ?? undefined;
    }

    const player = await resolvePlayerByName(options.path, playerName);
    return player?.id ?? null;
}

async function resolvePlayerByName(databasePath: string, searchText: string) {
    const queries = getPlayerSearchQueries(searchText);
    if (queries.length === 0) return null;

    const players: Player[] = [];
    const seen = new Set<number>();
    for (const query of queries) {
        const result = await query_players(databasePath, {
            name: query,
            options: {
                page: 1,
                pageSize: 12,
                skipCount: true,
                sort: "elo",
                direction: "desc",
            },
        });
        for (const player of result.data) {
            if (!seen.has(player.id)) {
                players.push(player);
                seen.add(player.id);
            }
        }
    }

    const normalizedSearch = normalizePlayerText(searchText);
    const tokens = normalizedSearch.split(" ").filter(Boolean);
    const exact = players.find(
        (player) => normalizePlayerText(player.name ?? "") === normalizedSearch,
    );
    if (exact) return exact;

    return (
        players.find((player) => {
            const normalizedName = normalizePlayerText(player.name ?? "");
            return tokens.length > 0 && tokens.every((token) => normalizedName.includes(token));
        }) ?? null
    );
}

function getLocalPlayerGameQuery(
    playerId: number | null | undefined,
    color: DatabaseResultPerspective,
): Partial<GameQuery> {
    if (playerId === undefined) return {};

    return {
        player1: playerId ?? -1,
        sides: color === "white" ? "WhiteBlack" : "BlackWhite",
    };
}

export function normalizePlayerText(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function getPlayerSearchQueries(searchText: string) {
    const normalized = normalizePlayerText(searchText);
    if (normalized.length < 3) return [];

    const queries = new Set([searchText.trim()]);
    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 2 && !searchText.includes(",")) {
        queries.add(`${tokens[1]}, ${tokens[0]}`);
    }
    for (const token of tokens) {
        if (token.length >= 3) queries.add(token);
    }

    return Array.from(queries).filter(Boolean);
}
