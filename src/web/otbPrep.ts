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

export function shouldSelectWebPrepPanel(
    previousActivePrepId: string | null,
    activePrepId: string | null,
) {
    return Boolean(activePrepId && activePrepId !== previousActivePrepId);
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
    const completion = {
        jobId: job.id,
        databaseId,
        databaseName: imported.database.name,
        opponent,
        gameCount: imported.games.length,
        prepId,
    };
    // The receipt is part of the workspace transaction, never a separate
    // localStorage acknowledgement. Replays must preserve edits and removals.
    if (state.completedOtbImports?.[job.id]) return { state, completion };
    const completedOtbImports = {
        ...state.completedOtbImports,
        [job.id]: { databaseId, prepId },
    };
    const timestamp = stableOtbTimestamp(job);
    const previousPrep = state.prepWorkspaces.find((prep) => prep.id === prepId) ?? null;
    // A pre-receipt workspace already imported this job. Migrate its marker
    // without merging the original artifact over later game annotations.
    if (previousPrep) return { state: { ...state, completedOtbImports }, completion };
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
            completedOtbImports,
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
        completion,
    };
}

function stableOtbTimestamp(job: WebOtbImportJob) {
    const parsed = Date.parse(job.completedAt || job.createdAt);
    return Number.isFinite(parsed) ? parsed : 0;
}
