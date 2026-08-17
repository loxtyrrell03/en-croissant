import { describe, expect, it } from "vitest";
import { getGamesForWebPrepSource } from "../prepIndex";
import { applyWebOtbPrepCompletion, shouldOpenWebOtbPrep } from "../otbPrep";
import { parsePgnDatabase } from "../pgn";
import { createEmptyWebState } from "../storage";
import type { WebOtbImportJob } from "../otbImport";

const OTB_PGN = `[Event "Open"]
[Date "2026.08.01"]
[White "Lapidus, Alexey"]
[Black "First Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0

[Event "Congress"]
[Date "2026.08.02"]
[White "Second Opponent"]
[Black "Lapidus, Alexey"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 1/2-1/2`;

function completedJob(): WebOtbImportJob {
    const prepDatabase = parsePgnDatabase("Lapidus, Alexey OTB games 2024-2026.pgn", OTB_PGN, 1234);
    prepDatabase.database.sourceKind = "source";
    return {
        id: "otb-complete",
        status: "completed",
        request: {
            playerName: "Alexey Lapidus",
            fideId: "1234567",
            fromYear: 2024,
            sources: {
                lichessBroadcasts: true,
                broadcastArchives: false,
                communityBroadcasts: false,
                chessResults: true,
                chessbaseNews: true,
                officialPgnIndexes: true,
                twic: true,
            },
        },
        progress: null,
        report: {
            playerName: "Lapidus, Alexey",
            fideId: "1234567",
            cancelled: false,
            gamesFound: 2,
            duplicatesRemoved: 0,
        },
        games: [],
        prepDatabase,
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:05:00.000Z",
        completedAt: "2026-08-17T12:05:00.000Z",
        error: null,
    };
}

describe("OTB completion Prep handoff", () => {
    it("opens one player Prep using every PC-prepared game", () => {
        const result = applyWebOtbPrepCompletion(createEmptyWebState(), completedJob(), "black");

        expect(result).not.toBeNull();
        const next = result!.state;
        const database = next.databases[0];
        const prep = next.prepWorkspaces[0];
        expect(database.gameCount).toBe(2);
        expect(next.gamesByDatabase[database.id]).toHaveLength(2);
        expect(
            next.gamesByDatabase[database.id].every((game) => game.databaseId === database.id),
        ).toBe(true);
        expect(prep).toMatchObject({
            id: "prep-otb-complete",
            mode: "player",
            source: "local",
            sourceIds: [database.id],
            opponent: "Lapidus, Alexey",
            userColor: "black",
            panelStage: "setup",
            rootPly: 0,
            line: [],
        });
        expect(next.activePrepId).toBe(prep.id);
        expect(
            getGamesForWebPrepSource({ gamesByDatabase: next.gamesByDatabase, prep }),
        ).toHaveLength(2);
    });

    it("is idempotent when the same completion is delivered again", () => {
        const job = completedJob();
        const first = applyWebOtbPrepCompletion(createEmptyWebState(), job, "white")!;
        first.state.prepWorkspaces[0].notesByFen.start = "keep my work";
        const second = applyWebOtbPrepCompletion(first.state, job, "black")!;

        expect(second.state.databases).toHaveLength(1);
        expect(second.state.prepWorkspaces).toHaveLength(1);
        expect(second.state.prepWorkspaces[0].notesByFen.start).toBe("keep my work");
        expect(second.state.prepWorkspaces[0].userColor).toBe("white");
    });

    it("does not navigate for unfinished, failed, or empty jobs", () => {
        const state = createEmptyWebState();
        const running = { ...completedJob(), status: "running" as const };
        const failed = { ...completedJob(), status: "failed" as const };
        const empty = {
            ...completedJob(),
            prepDatabase: { ...completedJob().prepDatabase!, games: [] },
        };

        expect(applyWebOtbPrepCompletion(state, running, "white")).toBeNull();
        expect(applyWebOtbPrepCompletion(state, failed, "white")).toBeNull();
        expect(applyWebOtbPrepCompletion(state, empty, "white")).toBeNull();
    });

    it("consumes a restored completion only once", () => {
        const job = completedJob();
        expect(shouldOpenWebOtbPrep(job, null, null)).toBe(true);
        expect(shouldOpenWebOtbPrep(job, null, job.id)).toBe(false);
        expect(shouldOpenWebOtbPrep(job, job.id, null)).toBe(false);
        expect(shouldOpenWebOtbPrep({ ...job, status: "running" }, null, null)).toBe(false);
    });
});
