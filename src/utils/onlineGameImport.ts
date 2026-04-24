import type { SetStateAction } from "react";
import { basename, resolve } from "@tauri-apps/api/path";
import { commands, events } from "@/bindings";
import { downloadChessCom } from "@/utils/chess.com/api";
import { downloadLichess } from "@/utils/lichess/api";
import type { DatabaseConversionState } from "@/state/atoms";
import { unwrap } from "@/utils/unwrap";

export type OnlineGameSource = "lichess" | "chesscom";

type SetDatabaseConversionState = (value: SetStateAction<DatabaseConversionState>) => void;

type ImportOnlineGamesOptions = {
    source: OnlineGameSource;
    username: string;
    databaseDir: string;
    dbPath: string;
    title: string;
    description?: string | null;
    since: number | null;
    remainingGames?: number;
    token?: string;
    setProgress?: (progress: number) => void;
    setConversionState: SetDatabaseConversionState;
};

export function getOnlineGameSourceLabel(source: OnlineGameSource) {
    return source === "lichess" ? "Lichess" : "Chess.com";
}

export function getOnlineGameImportId(source: OnlineGameSource, username: string) {
    return `${source}_${username}`;
}

export function getOnlineGamePgnFilename(source: OnlineGameSource, username: string) {
    return `${username}_${source}.pgn`;
}

export function getOnlineGameDatabaseFilename(source: OnlineGameSource, username: string) {
    return `${username}_${source}.db3`;
}

export function getDefaultOnlineGameDatabaseTitle(source: OnlineGameSource, username: string) {
    return `${username} ${getOnlineGameSourceLabel(source)}`;
}

export function resetDatabaseConversionState(setConversionState: SetDatabaseConversionState) {
    setConversionState((prev) => ({
        ...prev,
        inProgress: false,
        phase: null,
        progress: null,
        progressId: null,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: null,
        targetDatabaseTitle: null,
        sourceFileName: null,
    }));
}

export async function importOnlineGamesToDatabase({
    source,
    username,
    databaseDir,
    dbPath,
    title,
    description,
    since,
    remainingGames = 0,
    token,
    setProgress = () => {},
    setConversionState,
}: ImportOnlineGamesOptions) {
    const pgnPath = await resolve(databaseDir, getOnlineGamePgnFilename(source, username));
    const sourceFileName = await basename(pgnPath);
    const progressId = getOnlineGameImportId(source, username);

    setConversionState((prev) => ({
        ...prev,
        inProgress: true,
        phase: "downloading",
        progress: 0,
        progressId,
        totalGames: 0,
        totalGamesExpected: null,
        elapsedSeconds: 0,
        targetDatabasePath: dbPath,
        targetDatabaseTitle: title,
        sourceFileName,
    }));

    if (source === "lichess") {
        await downloadLichess(username, since, remainingGames, setProgress, token);
    } else {
        await downloadChessCom(username, since);
    }

    const totalGamesExpected = unwrap(await commands.countPgnGames(pgnPath));
    setConversionState((prev) => ({
        ...prev,
        phase: "converting",
        progress: totalGamesExpected > 0 ? 0 : null,
        progressId: null,
        totalGames: 0,
        totalGamesExpected,
        elapsedSeconds: 0,
    }));

    unwrap(
        await commands.convertPgn(
            pgnPath,
            dbPath,
            since ? since / 1000 : null,
            title,
            description ?? null,
        ),
    );
    await commands.deleteEmptyGames(dbPath);
    await events.progressEvent.emit({
        id: progressId,
        progress: 100,
        finished: true,
    });
}
