import { INITIAL_FEN } from "chessops/fen";
import { mergeImportedWebDatabases } from "./databaseSync";
import type { WebColor, WebCompanionState, WebPrepWorkspace } from "./model";
import { getWebOtbJobPlayerName, type WebOtbImportJob } from "./otbImport";
import { createEmptyWebBoardState } from "./storage";

export type WebOtbPrepCompletion = {
    jobId: string;
    databaseId: string;
    databaseName: string;
    opponent: string;
    gameCount: number;
    prepId: string;
};

export function shouldOpenWebOtbPrep(
    job: WebOtbImportJob | null,
    handledJobId: string | null,
    inFlightJobId: string | null,
) {
    return Boolean(
        job?.status === "completed" &&
        job.prepDatabase?.games.length &&
        handledJobId !== job.id &&
        inFlightJobId !== job.id,
    );
}

export function applyWebOtbPrepCompletion(
    state: WebCompanionState,
    job: WebOtbImportJob,
    userColor: WebColor,
): { state: WebCompanionState; completion: WebOtbPrepCompletion } | null {
    const imported = job.prepDatabase;
    if (job.status !== "completed" || !imported || imported.games.length === 0) return null;

    const opponent = getWebOtbJobPlayerName(job);
    if (!opponent) return null;

    const databaseId = imported.database.id;
    const prepId = `prep-${job.id}`;
    const timestamp = stableOtbTimestamp(job);
    const previousPrep = state.prepWorkspaces.find((prep) => prep.id === prepId) ?? null;
    const prep: WebPrepWorkspace = previousPrep ?? {
        id: prepId,
        name: `Prep vs ${opponent}`,
        mode: "player",
        source: "local",
        opponent,
        userColor,
        sourceIds: [databaseId],
        startFen: INITIAL_FEN,
        rootPly: 0,
        line: [],
        notesByFen: {},
        preparedMoves: {},
        skippedMoves: {},
        panelStage: "setup",
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const merged = mergeImportedWebDatabases(state, [imported]);
    const prepWorkspaces = previousPrep
        ? merged.prepWorkspaces
        : [prep, ...merged.prepWorkspaces.filter((candidate) => candidate.id !== prepId)];

    return {
        state: {
            ...merged,
            prepWorkspaces,
            activePrepId: prep.id,
            board: previousPrep
                ? merged.board
                : {
                      ...createEmptyWebBoardState(),
                      orientation: userColor,
                      sourceTitle: prep.name,
                  },
        },
        completion: {
            jobId: job.id,
            databaseId,
            databaseName: imported.database.name,
            opponent,
            gameCount: imported.games.length,
            prepId,
        },
    };
}

function stableOtbTimestamp(job: WebOtbImportJob) {
    const parsed = Date.parse(job.completedAt || job.createdAt);
    return Number.isFinite(parsed) ? parsed : 0;
}
