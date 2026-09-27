import { INITIAL_FEN } from "chessops/fen";
import type { WebCompanionState, WebGame } from "@/web/model";
import type { WebOtbImportJob } from "@/web/otbImport";
import { webStateSession } from "@/web/webStateSession";
import type { OpponentCollection } from "./platform";

function identity(game: WebGame) {
    return JSON.stringify([
        game.white,
        game.black,
        game.date,
        game.event,
        game.result,
        game.moves[0]?.fenBefore,
        game.moves.map((move) => move.uci ?? move.san),
    ]);
}

/** Append missing games only. Existing game IDs, notes, board and Prep remain intact. */
export function mergePhoneTournamentImport(
    state: WebCompanionState,
    job: WebOtbImportJob,
    collection: OpponentCollection,
): WebCompanionState {
    if (job.status !== "completed" || !job.prepDatabase)
        throw new Error("The downloaded games are not ready to save.");
    const databaseId = `tournament-opponent-${collection.id}`,
        prepId = `prep-${databaseId}`;
    if (state.completedOtbImports?.[job.id]) return state;
    const previous = state.gamesByDatabase[databaseId] ?? [];
    const known = new Set(previous.map(identity));
    const games = [...previous];
    let index = previous.reduce((max, game) => Math.max(max, game.index), -1) + 1;
    for (const game of job.prepDatabase.games) {
        const key = identity(game);
        if (known.has(key)) continue;
        known.add(key);
        games.push({
            ...game,
            index,
            id: `${databaseId}:${index++}`,
            databaseId,
            databaseName: collection.name,
        });
    }
    const old = state.databases.find((database) => database.id === databaseId);
    const database = {
        ...job.prepDatabase.database,
        ...old,
        id: databaseId,
        name: collection.name,
        gameCount: games.length,
        updatedAt: Date.now(),
    };
    const prep = state.prepWorkspaces.find((value) => value.id === prepId) ?? {
        id: prepId,
        name: `Prep vs ${job.request.playerName}`,
        mode: "player" as const,
        source: "local" as const,
        opponent: job.request.playerName,
        userColor: "white" as const,
        sourceIds: [databaseId],
        startFen: INITIAL_FEN,
        rootPly: 0,
        line: [],
        notesByFen: {},
        preparedMoves: {},
        skippedMoves: {},
        panelStage: "setup" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    return {
        ...state,
        databases: [database, ...state.databases.filter((value) => value.id !== databaseId)],
        gamesByDatabase: { ...state.gamesByDatabase, [databaseId]: games },
        prepWorkspaces: state.prepWorkspaces.some((value) => value.id === prepId)
            ? state.prepWorkspaces
            : [prep, ...state.prepWorkspaces],
        completedOtbImports: { ...state.completedOtbImports, [job.id]: { databaseId, prepId } },
    };
}

export async function savePhoneTournamentImport(
    job: WebOtbImportJob,
    collection: OpponentCollection,
) {
    await webStateSession.load();
    webStateSession.setState((current) => mergePhoneTournamentImport(current, job, collection));
    await webStateSession.flush();
    const databaseId = `tournament-opponent-${collection.id}`,
        prepId = `prep-${databaseId}`;
    const saved = webStateSession.getSnapshot().savedState;
    if (!saved?.databases.some((database) => database.id === databaseId))
        throw new Error(
            "This opponent database was removed from the phone. Start a new import to restore it.",
        );
    return {
        phoneDatabaseId: databaseId,
        phonePrepId: prepId,
        gameCount: saved.gamesByDatabase[databaseId]?.length ?? 0,
    };
}

export async function deletePhoneTournamentImport(collection: OpponentCollection) {
    await webStateSession.load();
    const databaseId = `tournament-opponent-${collection.id}`;
    webStateSession.setState((state) => {
        const gamesByDatabase = { ...state.gamesByDatabase };
        delete gamesByDatabase[databaseId];
        return {
            ...state,
            databases: state.databases.filter((db) => db.id !== databaseId),
            gamesByDatabase,
            prepWorkspaces: state.prepWorkspaces.map((prep) => ({
                ...prep,
                sourceIds: prep.sourceIds.filter((id) => id !== databaseId),
            })),
        };
    });
    await webStateSession.flush();
}
