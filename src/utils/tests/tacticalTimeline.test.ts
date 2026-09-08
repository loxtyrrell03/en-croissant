import { describe, expect, test } from "vitest";
import {
    buildTacticalTimeline,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
    buildMistakeReviewTacticalExplanation,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { positionSchema } from "@/components/files/opening";

describe("tactical causes and continuation evidence", () => {
    test("shows an opponent counterfork at its own ply without replacing the main queen capture", () => {
        const fen = "6k1/8/4q3/8/1n6/8/4R3/R3K3 w Q - 0 1";
        const pvUci = ["e2e6", "b4c2", "e1d1", "c2a1"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(4);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0].id).toBe("hangingPiece");
        expect(result.timeline).toContainEqual(
            expect.objectContaining({
                id: "fork",
                ply: 2,
                moveUci: "b4c2",
                actor: "black",
                relevance: "secondary",
            }),
        );
        expect(result.timeline).toContainEqual(
            expect.objectContaining({
                id: "hangingPiece",
                ply: 4,
                moveUci: "c2a1",
                actor: "black",
            }),
        );
        expect(result.motifs.some((m) => m.ply === 2)).toBe(false);
    });

    test("retains repeated forks instead of deduplicating the theme across a line", () => {
        const fen = "2bqk2r/p1pn1ppp/1p1p1n2/2N1N1r1/2B5/4P3/PPPP1PPP/R1BQK2R w KQk - 0 5";
        const line = ["e5f7", "d8e7", "f7h8", "e8f8", "c5e6", "f8g8", "e6g5"];
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.motifs[0].id).toBe("fork");
        const forks = result.timeline?.filter((m) => m.id === "fork");
        expect(forks?.map((m) => m.ply)).toEqual([1, 5]);
        expect(forks?.every((m) => m.actor === "white")).toBe(true);
    });

    test("does not manufacture counter-tactics from a quiet exchange sequence", () => {
        const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        const line = ["d2d4", "d7d5", "c2c4", "e7e6", "c4d5", "e6d5"];
        expect(buildTacticalTimeline(fen, line, "available", [])).toEqual([]);
    });

    test("does not transplant global castling or check tags onto Nxf7", () => {
        const result = classifyPositionTacticalMotifs({
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            pvUci: [
                "e5f7",
                "d7d5",
                "f7d8",
                "d5c4",
                "b2b3",
                "e7d8",
                "d1f3",
                "c7c6",
                "c1a3",
                "c8g4",
                "f3f4",
                "g4e6",
                "f2f3",
                "b8d7",
                "e1g1",
            ],
        });
        expect(result.motifs[0].id).toBe("fork");
        expect(result.timeline?.map((m) => m.id)).not.toEqual(expect.arrayContaining(["castling"]));
        expect(result.timeline?.map((m) => m.id)).not.toContain("check");
    });

    test("a deflection payoff does not create an unrelated pin or label routine recaptures", () => {
        const result = classifyPositionTacticalMotifs({
            fen: "3r2k1/p4ppp/1p6/2pr2q1/4R3/1P2PQ2/P5PP/3R2K1 w - - 0 23",
            pvUci: ["d1d5", "g5d5", "e4e8", "d8e8", "f3d5"],
        });
        expect(result.motifs[0].id).toBe("deflection");
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 5 }),
        );
        expect(
            result.timeline?.some((m) => m.id === "hangingPiece" && [2, 4].includes(m.ply ?? 0)),
        ).toBe(false);
        expect(result.timeline?.some((m) => m.id === "pin" && m.ply === 5)).toBe(false);
    });

    test("a later geometric fork remains unlabelled when a pawn can take its knight", () => {
        const fen = "1nbqk2r/p1pp1ppp/1p3n2/2N1N1r1/2B5/4P3/PPPP1PPP/R1BQK2R w KQk - 0 5";
        const line = ["e5f7", "d8e7", "f7h8", "e8f8", "c5e6", "d7e6"];
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 5)).toBe(false);
    });

    test("explains the legal difference made by preventing the king-rook fork", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/8/8/1n6/8/8/R3K2R w KQ - 0 1",
            bestMoveUci: "e1d1",
            playedMoveUci: "h1h3",
            pvUci: ["e1d1"],
            refutationUci: ["b4c2", "e1d1", "c2a1"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", comparison: "prevented" });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Kd1");
        expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
            "no longer has two profitable fork targets",
        );
    });

    test("distinguishes missing a queen from a knight capture that the best move also permits", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "6k1/8/7p/6N1/4q3/3P4/8/K7 w - - 0 1",
            bestMoveUci: "d3e4",
            playedMoveUci: "a1b1",
            pvUci: ["d3e4", "h6g5"],
            refutationUci: ["h6g5"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "hangingPiece",
            comparison: "persists",
        });
        expect(buildMistakeReviewTacticalExplanation(result)?.source).toBe("missed");
        expect(buildMistakeReviewTacticalExplanation(result)?.primary.evidence).toContain(
            "queen on e4",
        );
    });

    test("does not assert causation when the same capture remains after both moves", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/7p/6N1/8/8/8/4K3 w - - 0 1",
            bestMoveUci: "e1f2",
            playedMoveUci: "e1d1",
            pvUci: ["e1f2"],
            refutationUci: ["h6g5"],
        });
        expect(result.allowedMotifs[0].comparison).toBe("persists");
        expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
            "does not explain the difference",
        );
    });

    test("saved review metadata retains actors, repeated plies and causal comparisons", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/8/8/1n6/8/8/R3K2R w KQ - 0 1",
            bestMoveUci: "e1d1",
            playedMoveUci: "h1h3",
            pvUci: ["e1d1"],
            refutationUci: ["b4c2", "e1d1", "c2a1"],
        });
        const restored = positionSchema.shape.mistakeReview.parse(
            JSON.parse(JSON.stringify(result)),
        );
        expect(restored?.allowedMotifs?.[0].comparison).toBe("prevented");
        expect(restored?.allowedTimeline).toEqual(result.allowedTimeline);
    });

    test("names the escape square created by the better defensive move", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "6k1/1p3ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1",
            bestMoveUci: "h7h6",
            playedMoveUci: "b7b6",
            pvUci: ["h7h6"],
            refutationUci: ["e1e8"],
        });
        expect(result.allowedMotifs[0]).toMatchObject({
            id: "backRankMate",
            comparison: "prevented",
        });
        expect(result.allowedMotifs[0].comparisonEvidence).toContain("Kh7");
    });
});
