import { describe, expect, test, vi } from "vitest";
import { parsePgnDatabase } from "@/web/pgn";
import { createEmptyWebState } from "@/web/storage";
import type { WebOtbImportJob } from "@/web/otbImport";
import type { OpponentCollection } from "../platform";
import { DEFAULT_OTB_IMPORT_SOURCES } from "../otbImportModel";
const session = vi.hoisted(() => ({
    load: vi.fn(),
    setState: vi.fn(),
    flush: vi.fn(),
    getSnapshot: vi.fn(),
}));
vi.mock("@/web/webStateSession", () => ({ webStateSession: session }));
import { mergePhoneTournamentImport, savePhoneTournamentImport } from "../phoneTournament";
const collection = {
    id: 7,
    name: "Example opponent",
    metadata: {},
    game_count: 0,
} as OpponentCollection;
function job(id = "otb-first", moves = "1. e4 e5 2. Nf3 Nc6 1-0"): WebOtbImportJob {
    return {
        id,
        status: "completed",
        request: {
            playerName: "Alex Example",
            fideId: "123",
            fromYear: 2020,
            sources: DEFAULT_OTB_IMPORT_SOURCES,
        },
        prepDatabase: parsePgnDatabase(
            "fixture.pgn",
            `[Event "Synthetic"]\n[Date "2026.01.01"]\n[White "Alex Example"]\n[Black "Test Opponent"]\n[Result "1-0"]\n\n${moves}`,
            1234,
        ),
        games: [],
        progress: null,
        report: null,
        createdAt: "",
        updatedAt: "",
        completedAt: "",
        error: null,
    };
}
describe("phone tournament saves", () => {
    test("appends only new games while preserving IDs, notes and active board", () => {
        const first = mergePhoneTournamentImport(createEmptyWebState(), job(), collection);
        const id = "tournament-opponent-7",
            game = first.gamesByDatabase[id][0];
        first.prepWorkspaces[0].notesByFen = { position: "Keep this plan" };
        first.board.sourceTitle = "Unrelated study";
        const second = mergePhoneTournamentImport(first, job("otb-update"), collection);
        expect(second.gamesByDatabase[id]).toHaveLength(1);
        expect(second.gamesByDatabase[id][0]).toBe(game);
        expect(second.prepWorkspaces[0]).toBe(first.prepWorkspaces[0]);
        expect(second.board).toBe(first.board);
        const third = mergePhoneTournamentImport(
            second,
            job("otb-new", "1. d4 d5 1-0"),
            collection,
        );
        expect(third.gamesByDatabase[id]).toHaveLength(2);
        expect(new Set(third.gamesByDatabase[id].map((g) => g.id)).size).toBe(2);
    });
    test("replaying a saved job never resurrects user-deleted games", () => {
        const first = mergePhoneTournamentImport(createEmptyWebState(), job(), collection);
        first.gamesByDatabase["tournament-opponent-7"] = [];
        expect(mergePhoneTournamentImport(first, job(), collection)).toBe(first);
    });
    test("does not announce completion if durable storage rejects the save", async () => {
        session.load.mockResolvedValue(undefined);
        session.flush.mockRejectedValueOnce(new Error("Storage full"));
        await expect(savePhoneTournamentImport(job(), collection)).rejects.toThrow("Storage full");
        expect(session.getSnapshot).not.toHaveBeenCalled();
    });
});
