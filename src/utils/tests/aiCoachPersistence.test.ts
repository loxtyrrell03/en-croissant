import { describe, expect, test } from "vitest";
import type { AiCoachResponse } from "@/bindings";
import {
    createAiCoachPersistenceContext,
    createPersistedAiCoachReview,
    getAiCoachPersistenceTarget,
    getAiCoachSidecarPath,
    parseAiCoachSidecar,
    persistedAiCoachReviewMatches,
} from "@/utils/aiCoachPersistence";
import type { Tab } from "@/utils/tabs";

function response(scope: "whole_game" | "current_line"): AiCoachResponse {
    return {
        answer: "Develop before starting a wing attack.",
        overview: "The opening plan mattered most.",
        categories: [
            {
                id: "opening",
                label: "Opening",
                summary: "Development lagged.",
                explanation: "Complete development first.",
                positions: [
                    {
                        ply: 8,
                        san: "h4",
                        title: "Premature wing play",
                        explanation: "The centre was unresolved.",
                        engineEvidence: "...d5 was timely.",
                        betterPlan: "Be2 and O-O.",
                    },
                ],
                bookReferences: [
                    { chunkId: "book-1-page-4", whyItMatters: "Same structure.", positionPly: 8 },
                ],
            },
        ],
        analysisCoverage: {
            totalPositions: 20,
            uniquePositions: 20,
            cloudHits: 12,
            liveAnalyses: 8,
            failed: 0,
            liveDepth: 18,
            complete: true,
        },
        pgnScope: scope,
        model: "gpt-5.6-sol",
        usedExistingAnalysis: false,
        stockfishLines: [],
        targetedResults: [],
        bookPassages: [],
        bookCorpusAvailable: true,
    };
}

function context(currentFen = "fen-a", currentPath = [0, 0], currentLinePgn = "1. e4 e5") {
    return createAiCoachPersistenceContext({
        rootFen: "root-fen",
        wholeGamePgn: "1. e4 e5 2. Nf3 *",
        currentFen,
        currentPath,
        currentLinePgn,
    });
}

function fileTab(gameNumber: number): Tab {
    return {
        name: "Games",
        value: `tab-${gameNumber}`,
        type: "analysis",
        gameOrigin: {
            kind: "file",
            gameNumber,
            file: {
                type: "file",
                name: "games.pgn",
                path: "C:\\Chess\\games.pgn",
                numGames: 5,
                numGamesKnown: true,
                metadata: { type: "game", tags: [] },
                lastModified: 1,
            },
        },
    };
}

describe("AI Coach review persistence", () => {
    test("isolates games inside one PGN while sharing its dedicated sidecar", () => {
        const first = getAiCoachPersistenceTarget(fileTab(0));
        const fifth = getAiCoachPersistenceTarget(fileTab(4));

        expect(first?.sidecarPath).toBe("C:\\Chess\\games.pgn.coach.json");
        expect(fifth?.sidecarPath).toBe(first?.sidecarPath);
        expect(first?.recordKey).toBe("pgn:0");
        expect(fifth?.recordKey).toBe("pgn:4");
        expect(getAiCoachSidecarPath("C:\\Chess\\games.pgn")).toBe(first?.sidecarPath);
    });

    test("uses the database game id as the record identity", () => {
        const target = getAiCoachPersistenceTarget({
            ...fileTab(0),
            gameOrigin: { kind: "database", database: "C:\\Chess\\games.db", gameId: 87 },
        });

        expect(target).toEqual({
            sidecarPath: "C:\\Chess\\games.db.coach.json",
            recordKey: "database:87",
            sourceKind: "database",
        });
    });

    test("current-line reviews require the exact game, side, FEN, path and line", () => {
        const original = context();
        const review = createPersistedAiCoachReview({
            savedAt: "2026-07-21T12:00:00.000Z",
            question: "What went wrong?",
            playerColor: "white",
            response: response("current_line"),
            context: original,
            baseHalfMoves: 2,
            baseSanMoves: ["e4", "e5"],
        });

        expect(persistedAiCoachReviewMatches(review, original, "white")).toBe(true);
        expect(persistedAiCoachReviewMatches(review, original, "black")).toBe(false);
        expect(persistedAiCoachReviewMatches(review, context("fen-b"), "white")).toBe(false);
        expect(persistedAiCoachReviewMatches(review, context("fen-a", [0, 1]), "white")).toBe(
            false,
        );
        expect(
            persistedAiCoachReviewMatches(
                review,
                createAiCoachPersistenceContext({
                    rootFen: "root-fen",
                    wholeGamePgn: "1. e4 e5 2. Nf3 *",
                    currentFen: "fen-a",
                    currentPath: [0, 0],
                    currentLinePgn: "1. d4 d5",
                }),
                "white",
            ),
        ).toBe(false);
    });

    test("whole-game reviews survive navigation but never cross game or side", () => {
        const original = context();
        const review = createPersistedAiCoachReview({
            question: "Review the game",
            playerColor: "black",
            response: response("whole_game"),
            context: original,
            baseHalfMoves: 2,
            baseSanMoves: ["e4", "e5"],
        });
        const elsewhere = context("fen-later", [0, 0, 0]);
        const otherGame = createAiCoachPersistenceContext({
            rootFen: "root-fen",
            wholeGamePgn: "1. d4 d5 *",
            currentFen: "fen-later",
            currentPath: [0],
            currentLinePgn: "1. d4",
        });

        expect(persistedAiCoachReviewMatches(review, elsewhere, "black")).toBe(true);
        expect(persistedAiCoachReviewMatches(review, elsewhere, "white")).toBe(false);
        expect(persistedAiCoachReviewMatches(review, otherGame, "black")).toBe(false);
    });

    test("rejects corrupt, unknown-version and scope-mismatched sidecars", () => {
        const review = createPersistedAiCoachReview({
            question: "Review",
            playerColor: "white",
            response: response("whole_game"),
            context: context(),
            baseHalfMoves: 0,
            baseSanMoves: [],
        });

        expect(parseAiCoachSidecar("{")).toBeNull();
        expect(parseAiCoachSidecar(JSON.stringify({ version: 2, records: {} }))).toBeNull();
        expect(
            parseAiCoachSidecar(
                JSON.stringify({
                    version: 1,
                    records: {
                        "pgn:0": {
                            ...review,
                            response: { ...review.response, pgnScope: "current_line" },
                        },
                    },
                }),
            ),
        ).toBeNull();
    });

    test("fails closed when the backend returns an unsupported scope", () => {
        expect(() =>
            createPersistedAiCoachReview({
                question: "Review",
                playerColor: "white",
                response: { ...response("whole_game"), pgnScope: "auto" },
                context: context(),
                baseHalfMoves: 0,
                baseSanMoves: [],
            }),
        ).toThrow(/unsupported PGN scope/i);
    });
});
