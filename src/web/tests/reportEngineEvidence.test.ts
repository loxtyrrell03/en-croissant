import { describe, expect, test } from "vitest";
import { createReportEngineEvidence } from "../reportEngineEvidence";
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const limits = { depth: 8, timeMs: 50 };
describe("phone report score evidence", () => {
    test("uses the latest exact final choice rather than deepest/rank-one evidence", () => {
        const evidence = createReportEngineEvidence(fen, limits, 2);
        for (const line of [
            "info depth 8 score cp 100 pv d2d4 d7d5",
            "info depth 7 multipv 2 score cp 25 pv e2e4 e7e5",
            "info depth 5 multipv 2 score cp 17 pv e2e4 e7e5",
            "info depth 8 score cp 90 lowerbound pv e2e4",
        ])
            evidence.add(line, "gaming-pc", "Fixture");
        expect(evidence.finish("e2e4")).toMatchObject([
            { depth: 5, multipv: 2, score: { value: 17 }, sanMoves: ["e4", "e5"] },
        ]);
    });
    test("invalid and over-cap evidence cannot provide a report score or bridge a PV", () => {
        const evidence = createReportEngineEvidence(fen, limits, 1);
        for (const line of [
            "info depth 9 score cp 1 pv e2e4",
            "info depth 7 score cp 1 pv e2e4 junk e7e5",
            "info depth 7 score cp 1 pv e2e4 e2e3",
            "info depth 7 score cp 1 pv e2e5",
            "info depth 7 score cp 1 upperbound pv e2e4",
        ])
            evidence.add(line, "phone");
        expect(() => evidence.finish("e2e4")).toThrow(/exact legal score/);
    });
    test("Black starting positions retain White-point-of-view scores", () => {
        const evidence = createReportEngineEvidence(fen.replace(" w ", " b "), limits, 1);
        evidence.add("info depth 7 score cp 23 pv e7e5 e2e4", "phone");
        expect(evidence.finish("e7e5")[0].score.value).toBe(-23);
    });
    test("standard and Chess960 castling encodings share legal root identity", () => {
        const evidence = createReportEngineEvidence(
            "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
            limits,
            1,
        );
        evidence.add("info depth 6 score cp 12 pv e1h1 e8a8", "phone");
        expect(evidence.finish("e1g1")[0].sanMoves).toEqual(["O-O", "O-O-O"]);
    });
});
