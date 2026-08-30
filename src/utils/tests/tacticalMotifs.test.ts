import { describe, expect, test } from "vitest";
import {
    classifyMistakeReviewMotifs,
    MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
    tacticalMotifLabel,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

describe("Mistake Review tactical motif adapter", () => {
    test("preserves named mate evidence from a real Lichess puzzle", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "rr6/p3p2k/3pNpp1/1pp5/2q1P3/5R2/P2Q2PP/6K1 w - - 0 27",
            bestMoveSan: "Qh6+",
            bestMoveUci: "d2h6",
            pvUci: ["d2h6", "h7h6", "f3h3"],
            cpLoss: 500,
        });

        expect(result.motifClassifierVersion).toBe(MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION);
        expect(result.missedMotifs.map((motif) => motif.id)).toEqual(
            expect.arrayContaining(["mate", "mateIn2", "anastasiaMate"]),
        );
        expect(result.missedMotifs.find((motif) => motif.id === "anastasiaMate")).toMatchObject({
            label: "Anastasia Mate",
            confidence: "high",
            source: "missed",
            ply: 3,
            moveUci: "f3h3",
        });
    });

    test("keeps advanced sequence motifs and their triggering ply", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "3r2k1/p4ppp/1p6/2pr2q1/4R3/1P2PQ2/P5PP/3R2K1 w - - 0 23",
            bestMoveSan: "Rxd5",
            bestMoveUci: "d1d5",
            pvUci: ["d1d5", "g5d5", "e4e8", "d8e8", "f3d5"],
            cpLoss: 250,
        });

        expect(result.missedMotifs.map((motif) => motif.id)).toEqual(
            expect.arrayContaining(["deflection", "discoveredAttack"]),
        );
        const deflection = result.missedMotifs.find((motif) => motif.id === "deflection");
        expect(deflection).toMatchObject({
            label: "Deflection",
            confidence: "high",
            source: "missed",
        });
        expect(deflection?.ply).toBeGreaterThan(0);
        expect(deflection?.moveUci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    });

    test("keeps allowed motifs separate from missed motifs", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/8/8/1n6/8/8/R3K2R w KQ - 0 1",
            bestMoveSan: "Kd1",
            bestMoveUci: "e1d1",
            playedMoveSan: "Rh3",
            playedMoveUci: "h1h3",
            pvUci: ["e1d1", "b4c2", "d1c1"],
            refutationUci: ["b4c2", "e1d1"],
            cpLoss: 130,
        });

        expect(result.allowedMotifs.map((motif) => motif.id)).toContain(
            "attacking_undefended_piece",
        );
        expect(result.allowedMotifs.every((motif) => motif.source === "allowed")).toBe(true);
        expect(result.missedMotifs.every((motif) => motif.source === "missed")).toBe(true);
    });

    test("returns versioned empty evidence for unusable lines", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "not a fen",
            bestMoveUci: "invalid",
            playedMoveUci: "also-invalid",
        });

        expect(result).toEqual({
            allowedMotifs: [],
            missedMotifs: [],
            motifClassifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        });
        expect(tacticalMotifLabel("selfInterference")).toBe("Self-Interference");
    });
});
