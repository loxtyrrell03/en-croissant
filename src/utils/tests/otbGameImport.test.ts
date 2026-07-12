import { describe, expect, test } from "vitest";
import {
    createOtbImportRequest,
    getOtbImportDescription,
    getOtbImportProgressPercent,
    normalizeOtbFideId,
    validateOtbImportRequest,
} from "@/utils/otbGameImport";

describe("OTB game import", () => {
    test("builds an OTB-only request without online-account sources", () => {
        const request = createOtbImportRequest({
            jobId: "sameera-audit",
            playerName: "  Kodukula, Sameera  ",
            fideId: "FIDE 343413994",
            fromYear: 2024,
            sources: {
                lichessBroadcasts: true,
                chessResults: true,
                chessbaseNews: true,
                officialPgnIndexes: true,
                twic: true,
            },
            localPgnPaths: ["sameera.pgn", "sameera.pgn"],
            cacheDir: "cache",
            outputPath: "sameera-otb.pgn",
        });

        expect(request).toEqual({
            jobId: "sameera-audit",
            playerName: "Kodukula, Sameera",
            fideId: "343413994",
            fromYear: 2024,
            includeLichessBroadcasts: true,
            includeChessResults: true,
            includeChessbaseNews: true,
            includeOfficialPgnIndexes: true,
            includeTwic: true,
            localPgnPaths: ["sameera.pgn"],
            cacheDir: "cache",
            outputPath: "sameera-otb.pgn",
        });
        expect(Object.keys(request).join(" ").toLowerCase()).not.toContain("chesscom");
        expect(Object.keys(request).join(" ").toLowerCase()).not.toContain("username");
    });

    test("requires a deterministic identity and at least one OTB source", () => {
        const request = createOtbImportRequest({
            jobId: "empty",
            playerName: "A",
            fideId: "12",
            fromYear: 2024,
            sources: {
                lichessBroadcasts: false,
                chessResults: false,
                chessbaseNews: false,
                officialPgnIndexes: false,
                twic: false,
            },
            localPgnPaths: [],
            cacheDir: "cache",
            outputPath: "out.pgn",
        });
        expect(validateOtbImportRequest(request, 2026)).toBe("Enter the opponent's full name.");
        expect(normalizeOtbFideId("2427 6111")).toBe("24276111");
    });

    test("reports source provenance and strict online exclusions", () => {
        const description = getOtbImportDescription({
            playerName: "Lapidus, Alexey M.",
            fideId: "24276111",
            outputPath: "lapidus.pgn",
            gamesFound: 138,
            duplicatesRemoved: 65,
            suspectedOnlineGamesExcluded: 38,
            identityMismatchesExcluded: 2,
            newestGame: null,
            sources: [
                {
                    source: "Lichess broadcast database",
                    archivesChecked: 30,
                    cachedArchives: 0,
                    matchedGames: 74,
                    uniqueGamesAdded: 73,
                    errors: [],
                },
            ],
        });
        expect(description).toContain("OTB-only");
        expect(description).toContain("38 suspected online games excluded");
        expect(description).toContain("Lichess broadcast database: 73 unique");
    });

    test("clamps per-source progress", () => {
        expect(
            getOtbImportProgressPercent({
                jobId: "x",
                source: "TWIC",
                phase: "downloading",
                current: 3,
                total: 12,
                gamesFound: 4,
                message: "Checking",
            }),
        ).toBe(25);
        expect(getOtbImportProgressPercent(null)).toBeNull();
    });
});
