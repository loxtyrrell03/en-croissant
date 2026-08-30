import { describe, expect, test } from "vitest";
import {
    applyOtbImportLaneProgress,
    createOtbImportRequest,
    DEFAULT_OTB_IMPORT_SOURCES,
    formatOtbImportEta,
    getOtbImportDescription,
    getOtbImportEtaSeconds,
    getOtbImportLaneLabel,
    getOtbImportLaneSummary,
    getOtbImportProgressPercent,
    mergeOtbImportProgress,
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
                broadcastArchives: false,
                communityBroadcasts: false,
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
            includeLichessBroadcastArchives: false,
            includeLichessCommunityBroadcasts: false,
            includeChessResults: true,
            includeChessbaseNews: true,
            includeOfficialPgnIndexes: true,
            includeTwic: true,
            localPgnPaths: ["sameera.pgn"],
            cacheDir: "cache",
            outputPath: "sameera-otb.pgn",
        });
        expect(Object.keys(request)).not.toContain("chessComUsername");
        expect(Object.keys(request)).not.toContain("username");
    });

    test("requires a deterministic identity and at least one OTB source", () => {
        const request = createOtbImportRequest({
            jobId: "empty",
            playerName: "A",
            fideId: "12",
            fromYear: 2024,
            sources: {
                lichessBroadcasts: false,
                broadcastArchives: false,
                communityBroadcasts: false,
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
            cancelled: true,
            gamesFound: 138,
            duplicatesRemoved: 65,
            suspectedOnlineGamesExcluded: 38,
            identityMismatchesExcluded: 2,
            coverageComplete: false,
            coverageGaps: ["Import was cancelled before every selected source finished."],
            newestGame: null,
            sources: [
                {
                    source: "Lichess broadcast database",
                    elapsedMs: 0,
                    archivesChecked: 30,
                    cachedArchives: 0,
                    matchedGames: 74,
                    uniqueGamesAdded: 73,
                    errors: [],
                },
            ],
        });
        expect(description).toContain("OTB-only");
        expect(description).toContain("retained from a search stopped early");
        expect(description).toContain("Coverage incomplete");
        expect(description).toContain("38 suspected online games excluded");
        expect(description).toContain("Lichess broadcast database: 73 unique");
    });

    test("tracks parallel source lanes without run-level events", () => {
        const event = (source: string, phase: string, current = 0, total = 0) => ({
            jobId: "x",
            source,
            phase,
            current,
            total,
            gamesFound: 0,
            message: "",
        });

        let lanes = applyOtbImportLaneProgress(
            {},
            event("The Week in Chess", "downloading", 3, 12),
        );
        lanes = applyOtbImportLaneProgress(lanes, event("All sources", "starting", 0, 9));
        lanes = applyOtbImportLaneProgress(lanes, event("Complete", "complete", 1, 1));
        lanes = applyOtbImportLaneProgress(
            lanes,
            event("BritBase public OTB archive", "done", 1, 1),
        );

        const summary = getOtbImportLaneSummary(lanes, 9);
        expect(Object.keys(lanes)).toEqual(["The Week in Chess", "BritBase public OTB archive"]);
        expect(summary.done).toBe(1);
        expect(summary.total).toBe(9);
        expect(summary.entries.map((lane) => getOtbImportLaneLabel(lane.source))).toEqual([
            "BritBase",
            "TWIC",
        ]);
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

    test("enables every OTB source by default", () => {
        expect(DEFAULT_OTB_IMPORT_SOURCES).toEqual({
            lichessBroadcasts: true,
            broadcastArchives: true,
            communityBroadcasts: true,
            chessResults: true,
            chessbaseNews: true,
            officialPgnIndexes: true,
            twic: true,
        });
    });

    test("estimates the slowest parallel lane and formats the ETA", () => {
        const lanes = [
            {
                jobId: "otb-eta",
                source: "Community",
                phase: "downloading",
                current: 25,
                total: 100,
                gamesFound: 3,
                message: "Checking rosters",
            },
            {
                jobId: "otb-eta",
                source: "TWIC",
                phase: "done",
                current: 1,
                total: 1,
                gamesFound: 3,
                message: "Done",
            },
        ];
        expect(getOtbImportEtaSeconds(lanes, { Community: 10_000, TWIC: 10_000 }, 40_000)).toBe(90);
        expect(formatOtbImportEta(90)).toBe("about 2 min");
        expect(formatOtbImportEta(3_600)).toBe("about 1 hr");
    });

    test("does not let a stale parallel lane reset the games-found count", () => {
        const current = {
            jobId: "otb-4",
            source: "TWIC",
            phase: "scan",
            current: 12,
            total: 100,
            gamesFound: 37,
            message: "Scanning TWIC",
        };
        const staleLane = {
            ...current,
            source: "Lichess broadcast database",
            current: 2,
            gamesFound: 0,
            message: "Scanning broadcasts",
        };

        expect(mergeOtbImportProgress(current, staleLane)).toEqual({
            ...staleLane,
            gamesFound: 37,
        });
        expect(mergeOtbImportProgress(current, { ...staleLane, jobId: "otb-5" }).gamesFound).toBe(
            0,
        );
    });
});
