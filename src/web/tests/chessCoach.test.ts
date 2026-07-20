import { describe, expect, it } from "vitest";
import {
    getDefaultWebCoachScope,
    getWebCoachBookHeading,
    getWebCoachBookPdfUrl,
    getWebCoachLineContextKey,
    getWebCoachMoves,
    makeWebCoachMovetext,
    normalizeWebChessCoachResponse,
    webCoachLineMatchesSourceGame,
    type WebCoachBookPassage,
} from "../chessCoach";

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
});

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
