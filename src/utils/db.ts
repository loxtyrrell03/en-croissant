import { resolve } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
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

export async function getDatabases(): Promise<DatabaseInfo[]> {
    const dbDir = await getDatabasesDir();
    const files = await readDir(dbDir);
    const dbs = files.filter((file) => file.name?.endsWith(".db3"));
    return (await Promise.allSettled(dbs.map((db) => getDatabase(db.name))))
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<DatabaseInfo>).value);
}

async function getDatabase(name: string): Promise<DatabaseInfo> {
    const dbDir = await getDatabasesDir();
    const path = await resolve(dbDir, name);
    const res = await commands.getDbInfo(path);
    if (res.status === "ok") {
        return {
            type: "success",
            ...res.data,
            file: path,
        };
    }
    return {
        type: "error",
        filename: path,
        file: path,
        error: res.error,
        indexed: false,
    };
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
