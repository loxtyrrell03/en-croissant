import type { WebColor, WebCompanionState } from "./model";
import type { WebOtbImportJob } from "./otbImport";
import { applyWebOtbPrepCompletion } from "./otbPrep";
import { createEmptyWebBoardState } from "./storage";

export function readWebOtbPrepLink(search: string): { jobId: string; userColor: WebColor } | null {
    const params = new URLSearchParams(search);
    const jobId = params.get("otbPrep");
    const userColor = params.get("side");
    if (!jobId || !/^otb-[a-z0-9-]{1,90}$/i.test(jobId)) return null;
    return userColor === "white" || userColor === "black" ? { jobId, userColor } : null;
}

/** An explicit link opens a saved job on this device without replacing existing
 * games, annotations or prep marks. The side always belongs to the user. */
export function openWebOtbPrepLink(
    state: WebCompanionState,
    job: WebOtbImportJob,
    userColor: WebColor,
) {
    const imported = job.prepDatabase;
    const games = imported?.games.filter((game) => game.moves.length > 0);
    const prepared =
        imported && games
            ? {
                  ...job,
                  prepDatabase: {
                      ...imported,
                      games,
                      database: { ...imported.database, gameCount: games.length },
                  },
              }
            : job;
    const applied = applyWebOtbPrepCompletion(state, prepared, userColor);
    if (!applied) throw new Error("This OTB search has no completed games to prepare.");
    const prep = applied.state.prepWorkspaces.find((item) => item.id === applied.completion.prepId);
    if (!prep)
        throw new Error(
            "This prep was removed on this device. Import its games again to create a new prep.",
        );
    return {
        ...applied.state,
        activePrepId: prep.id,
        prepWorkspaces: applied.state.prepWorkspaces.map((item) =>
            item.id === prep.id ? { ...item, userColor, panelStage: "train" as const } : item,
        ),
        board: {
            ...createEmptyWebBoardState(),
            orientation: userColor,
            sourceTitle: prep.name,
            cursor: prep.rootPly ?? 0,
        },
    };
}
