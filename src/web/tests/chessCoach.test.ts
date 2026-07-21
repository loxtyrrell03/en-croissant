import { describe, expect, it } from "vitest";
import {
    createWebCoachReviewRecord,
    getDefaultWebCoachScope,
    getWebCoachBookHeading,
    getWebCoachBookPdfUrl,
    getWebCoachContextKey,
    getWebCoachLineContextKey,
    getWebCoachMoves,
    getWebCoachStorageKey,
    makeWebCoachMovetext,
    normalizeWebChessCoachResponse,
    persistWebCoachReviewInState,
    rebaseWebCoachReviewLineContext,
    restoreWebCoachReview,
    webCoachLineMatchesSourceGame,
    type WebCoachBookPassage,
    type WebChessCoachResponse,
} from "../chessCoach";
import type { WebGame, WebPrepLineMove } from "../model";
import { createEmptyWebState } from "../storage";

describe("phone chess coach context", () => {
    it("builds colour-aware move evidence from an analysis line", () => {
        const moves = getWebCoachMoves(null, [
            {
                actor: "user",
                san: "e4",
                uci: "e2e4",
                fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1",
                fenAfter: "8/8/8/8/8/8/8/8 b - - 0 1",
            },
            {
                actor: "opponent",
                san: "e5",
                uci: "e7e5",
                fenBefore: "8/8/8/8/8/8/8/8 b - - 0 1",
                fenAfter: "8/8/8/8/8/8/8/8 w - - 0 2",
            },
        ]);

        expect(moves.map((move) => [move.ply, move.color, move.san])).toEqual([
            [1, "white", "e4"],
            [2, "black", "e5"],
        ]);
        expect(moves.map((move) => move.uci)).toEqual(["e2e4", "e7e5"]);
        expect(makeWebCoachMovetext(moves)).toBe("1. e4 e5");
    });

    it("opens the exact retrieved PDF page", () => {
        const passage = {
            sourceUrl: "/api/chess-books/pdf?bookId=calculation",
            pdfPageStart: 12,
        } as WebCoachBookPassage;
        expect(getWebCoachBookPdfUrl(passage)).toContain(
            "api/chess-books/pdf?bookId=calculation#page=12",
        );
    });

    it("normalizes AI-selected tabs and keeps only references to returned passages", () => {
        const response = normalizeWebChessCoachResponse({
            overview: "Your opening plan drifted before a tactical mistake.",
            model: "gpt-5.6-sol",
            playerColor: "white",
            bookPassages: [bookPassage("chunk-opening", "Chess Structures", "The Isolated Pawn")],
            categories: [
                {
                    id: " Opening / Plans!!! ",
                    label: "Opening plans",
                    summary: "Understand the structure before choosing a move.",
                    explanation: "The position called for development, not a pawn grab.",
                    positions: [
                        {
                            ply: 9,
                            san: "h4?!",
                            title: "The plan changes",
                            explanation: "This spends a tempo before development is complete.",
                            engineEvidence: "+0.2 to -0.5",
                            betterPlan: "Castle and contest the centre.",
                        },
                    ],
                    bookReferences: [
                        {
                            chunkId: "chunk-opening",
                            whyItMatters: "The chapter explains the structure reached here.",
                            positionPly: 9,
                        },
                        { chunkId: "invented-chunk", whyItMatters: "Not returned by the server." },
                    ],
                },
                {
                    id: "opening plans",
                    label: "Calculation",
                    summary: "Check forcing replies.",
                    explanation: "A second valid topic with a duplicate raw id.",
                    positions: [],
                    bookReferences: [],
                },
                { id: "bad", label: "", explanation: "Missing labels are rejected." },
            ],
            analysisCoverage: {
                totalPositions: 42,
                uniquePositions: 42,
                cloudHits: 35,
                liveAnalyses: 7,
                failed: 0,
            },
        });

        expect(response?.categories.map((category) => category.id)).toEqual([
            "opening-plans",
            "opening-plans-2",
        ]);
        expect(response?.categories[0].bookReferences).toEqual([
            {
                chunkId: "chunk-opening",
                whyItMatters: "The chapter explains the structure reached here.",
                positionPly: 9,
            },
        ]);
        expect(response?.categories[0].positions[0].betterPlan).toBe(
            "Castle and contest the centre.",
        );
        expect(response?.analysisCoverage.cloudHits).toBe(35);
    });

    it("falls back cleanly to a legacy answer", () => {
        const response = normalizeWebChessCoachResponse({
            answer: "Legacy review text",
            playerColor: "black",
            criticalMoments: [],
            bookPassages: [],
        });

        expect(response).toMatchObject({
            answer: "Legacy review text",
            overview: "Legacy review text",
            categories: [],
            playerColor: "black",
        });
    });

    it("uses the real book and chapter names in source headings", () => {
        const passage = bookPassage("chunk-rooks", "100 Endgames You Must Know", "Rook Endgames");
        const heading = getWebCoachBookHeading(passage);

        expect(heading).toBe("100 Endgames You Must Know — Rook Endgames");
        expect(heading).not.toContain("[Book");
    });

    it("keeps a whole-game line context stable while the cursor navigates it", () => {
        const line: Parameters<typeof getWebCoachLineContextKey>[1] = [
            {
                actor: "user",
                san: "e4",
                uci: "e2e4",
                fenBefore: "start w KQkq - 0 1",
                fenAfter: "after-e4 b KQkq - 0 1",
            },
            {
                actor: "opponent",
                san: "e5",
                uci: "e7e5",
                fenBefore: "after-e4 b KQkq - 0 1",
                fenAfter: "after-e5 w KQkq - 0 2",
            },
        ];

        expect(getWebCoachLineContextKey(null, line, line[0].fenBefore)).toBe(
            getWebCoachLineContextKey(null, line, line[1].fenAfter),
        );
        expect(getWebCoachLineContextKey(null, line.slice(0, 1), line[0].fenAfter)).not.toBe(
            getWebCoachLineContextKey(null, line, line[1].fenAfter),
        );
    });

    it("detects whether a loaded source game still matches the reviewed board line", () => {
        const line: Parameters<typeof getWebCoachLineContextKey>[1] = [
            {
                actor: "user",
                san: "e4",
                uci: "e2e4",
                fenBefore: "start w KQkq - 0 1",
                fenAfter: "after-e4 b KQkq - 0 1",
            },
        ];
        const sourceMoves = getWebCoachMoves(null, line);
        const sourceGame = { id: "game-1", moves: sourceMoves };

        expect(webCoachLineMatchesSourceGame(sourceGame, line)).toBe(true);
        expect(
            webCoachLineMatchesSourceGame(sourceGame, [{ ...line[0], san: "d4", uci: "d2d4" }]),
        ).toBe(false);
        expect(getDefaultWebCoachScope(sourceGame, line)).toBe("whole-game");
        expect(getDefaultWebCoachScope(null, line)).toBe("position");
    });

    it("restores a saved review only for the exact game line and analysis context", () => {
        const line = reviewLine();
        const game = reviewGame("database-a:0", 0, line);
        const lineContextKey = getWebCoachLineContextKey(game, line, line[1].fenAfter);
        const contextKey = getWebCoachContextKey(
            lineContextKey,
            "whole-game",
            "white",
            line[1].fenAfter,
        );
        const record = createWebCoachReviewRecord({
            contextKey,
            lineContextKey,
            scope: "whole-game",
            playerColor: "white",
            question: "What should I learn?",
            response: coachResponse("Saved review"),
            savedAt: 123_456,
        });

        const restored = restoreWebCoachReview(JSON.parse(JSON.stringify(record)), {
            lineContextKey,
            currentFen: line[0].fenBefore,
        });
        expect(restored).toMatchObject({
            question: "What should I learn?",
            savedAt: 123_456,
            response: { overview: "Saved review" },
        });

        const editedLine = [{ ...line[0], san: "d4", uci: "d2d4" }, line[1]];
        const editedKey = getWebCoachLineContextKey(game, editedLine, line[1].fenAfter);
        expect(
            restoreWebCoachReview(record, {
                lineContextKey: editedKey,
                currentFen: line[1].fenAfter,
            }),
        ).toBeNull();
    });

    it("keeps position reviews tied to their selected position", () => {
        const line = reviewLine();
        const lineContextKey = getWebCoachLineContextKey(null, line, line[1].fenAfter);
        const record = createWebCoachReviewRecord({
            contextKey: getWebCoachContextKey(
                lineContextKey,
                "position",
                "black",
                line[1].fenAfter,
            ),
            lineContextKey,
            scope: "position",
            playerColor: "black",
            question: "Explain this position.",
            response: coachResponse("Position review"),
            savedAt: 222,
        });

        expect(
            restoreWebCoachReview(record, {
                lineContextKey,
                currentFen: line[1].fenAfter,
            })?.response.overview,
        ).toBe("Position review");
        expect(
            restoreWebCoachReview(record, {
                lineContextKey,
                currentFen: line[0].fenAfter,
            }),
        ).toBeNull();
    });

    it("stores one replaceable review on the exact source game", () => {
        const line = reviewLine();
        const firstGame = reviewGame("database-a:0", 0, line);
        const secondGame = reviewGame("database-a:1", 1, line);
        const state = {
            ...createEmptyWebState(),
            gamesByDatabase: { "database-a": [firstGame, secondGame] },
        };
        const firstRecord = reviewRecord(firstGame, line, "First answer", 100);
        const secondRecord = reviewRecord(firstGame, line, "Replacement answer", 200);

        const saved = persistWebCoachReviewInState(
            state,
            { sourceDatabaseId: "database-a", sourceGameId: firstGame.id },
            firstRecord,
        );
        const replaced = persistWebCoachReviewInState(
            saved,
            { sourceDatabaseId: "database-a", sourceGameId: firstGame.id },
            secondRecord,
        );

        expect(replaced.gamesByDatabase["database-a"][0].coachReview).toEqual(secondRecord);
        expect(replaced.gamesByDatabase["database-a"][1].coachReview).toBeUndefined();
        expect(replaced.board.coachReview).toBeUndefined();

        const reloaded = JSON.parse(JSON.stringify(replaced)) as typeof replaced;
        expect(
            restoreWebCoachReview(reloaded.gamesByDatabase["database-a"][0].coachReview, {
                lineContextKey: secondRecord.lineContextKey,
                currentFen: line[1].fenAfter,
            })?.response.overview,
        ).toBe("Replacement answer");
    });

    it("restores an uploaded game after its volatile browser source id changes", () => {
        const line = reviewLine();
        const sourceIdentity = "game:uploaded-db:0";
        const sourceLineKey = getWebCoachLineContextKey(
            null,
            line,
            line[1].fenAfter,
            sourceIdentity,
        );
        const record = createWebCoachReviewRecord({
            contextKey: getWebCoachContextKey(
                sourceLineKey,
                "whole-game",
                "white",
                line[1].fenAfter,
            ),
            lineContextKey: sourceLineKey,
            scope: "whole-game",
            playerColor: "white",
            question: "Review this upload.",
            response: coachResponse("Uploaded game review"),
            savedAt: 300,
        });
        const state = {
            ...createEmptyWebState(),
            board: {
                ...createEmptyWebState().board,
                sourceDatabaseId: "uploaded-db",
                sourceGameId: "uploaded-db:0",
            },
        };

        const saved = persistWebCoachReviewInState(
            state,
            { sourceDatabaseId: "uploaded-db", sourceGameId: "uploaded-db:0" },
            record,
        );
        expect(saved.board.coachReview).toEqual(record);
        expect(
            restoreWebCoachReview(saved.board.coachReview, {
                lineContextKey: sourceLineKey,
                currentFen: line[0].fenBefore,
            })?.response.overview,
        ).toBe("Uploaded game review");

        const otherSourceKey = getWebCoachLineContextKey(
            null,
            line,
            line[1].fenAfter,
            "game:different-upload:0",
        );
        expect(otherSourceKey).not.toBe(sourceLineKey);
        expect(getWebCoachStorageKey(otherSourceKey)).toBe(getWebCoachStorageKey(sourceLineKey));
        const reopenedReview = rebaseWebCoachReviewLineContext(
            saved.board.coachReview!,
            otherSourceKey,
        );
        expect(
            restoreWebCoachReview(reopenedReview, {
                lineContextKey: otherSourceKey,
                currentFen: line[1].fenAfter,
            })?.response.overview,
        ).toBe("Uploaded game review");

        const differentLineKey = getWebCoachLineContextKey(
            null,
            [{ ...line[0], san: "d4", uci: "d2d4" }, line[1]],
            line[1].fenAfter,
            "game:different-upload:0",
        );
        expect(getWebCoachStorageKey(differentLineKey)).not.toBe(
            getWebCoachStorageKey(sourceLineKey),
        );
        expect(
            restoreWebCoachReview(saved.board.coachReview, {
                lineContextKey: differentLineKey,
                currentFen: line[1].fenAfter,
            }),
        ).toBeNull();
    });
});

function reviewLine(): WebPrepLineMove[] {
    return [
        {
            actor: "user",
            san: "e4",
            uci: "e2e4",
            fenBefore: "start w KQkq - 0 1",
            fenAfter: "after-e4 b KQkq - 0 1",
        },
        {
            actor: "opponent",
            san: "e5",
            uci: "e7e5",
            fenBefore: "after-e4 b KQkq - 0 1",
            fenAfter: "after-e5 w KQkq - 0 2",
        },
    ];
}

function reviewGame(id: string, index: number, line: WebPrepLineMove[]): WebGame {
    return {
        id,
        databaseId: "database-a",
        databaseName: "Games",
        index,
        event: "Training game",
        site: "London",
        date: "2026.07.21",
        white: "White",
        black: "Black",
        whiteElo: 2200,
        blackElo: 2200,
        result: "1-0",
        pgn: "1. e4 e5 1-0",
        moves: getWebCoachMoves(null, line),
        importedAt: 1,
    };
}

function coachResponse(overview: string): WebChessCoachResponse {
    const response = normalizeWebChessCoachResponse({
        overview,
        playerColor: "white",
        categories: [
            {
                id: "opening",
                label: "Opening",
                summary: "Opening lesson",
                explanation: "Develop first.",
            },
        ],
        bookPassages: [],
    });
    if (!response) throw new Error("The coach response fixture must normalize.");
    return response;
}

function reviewRecord(game: WebGame, line: WebPrepLineMove[], overview: string, savedAt: number) {
    const lineContextKey = getWebCoachLineContextKey(game, line, line.at(-1)?.fenAfter ?? "");
    return createWebCoachReviewRecord({
        contextKey: getWebCoachContextKey(
            lineContextKey,
            "whole-game",
            "white",
            line.at(-1)?.fenAfter ?? "",
        ),
        lineContextKey,
        scope: "whole-game",
        playerColor: "white",
        question: "Review this game.",
        response: coachResponse(overview),
        savedAt,
    });
}

function bookPassage(chunkId: string, title: string, chapterTitle: string): WebCoachBookPassage {
    return {
        chunkId,
        bookId: `book-${chunkId}`,
        title,
        author: "A Grandmaster",
        shelf: "Strategy",
        chapterTitle,
        citation: "PDF p. 12",
        pdfPageStart: 12,
        pdfPageEnd: 12,
        printedPageStart: null,
        printedPageEnd: null,
        excerpt: "A short lawful excerpt.",
        sourceUrl: `/api/chess-books/pdf?bookId=book-${chunkId}`,
    };
}
