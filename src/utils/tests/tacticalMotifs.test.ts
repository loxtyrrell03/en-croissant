import { describe, expect, test } from "vitest";
import {
    buildMistakeReviewTacticalExplanation,
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
            expect.arrayContaining(["mateIn2", "anastasiaMate"]),
        );
        expect(result.missedMotifs.map((motif) => motif.id)).not.toContain("mate");
        expect(result.missedMotifs.find((motif) => motif.id === "anastasiaMate")).toMatchObject({
            label: "Anastasia Mate",
            confidence: "high",
            source: "missed",
            ply: 3,
            moveUci: "f3h3",
        });
    });

    test("explains the screenshot Nxf7 fork with verified targets and payoff", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            bestMoveUci: "e5f7",
            pvUci: ["e5f7", "d7d5", "f7d8"],
            pvSan: ["Nxf7", "d5", "Nxd8"],
            cpLoss: 400,
        });

        expect(result.missedMotifs.map((motif) => motif.id)).toEqual([
            "fork",
            "attackingF2F7",
        ]);
        expect(result.missedMotifs[0]).toMatchObject({
            label: "Fork",
            source: "missed",
            moveUci: "e5f7",
        });
        expect(result.missedMotifs[0].evidence).toContain("queen on d8 and rook on h8");
        expect(result.missedMotifs[0].evidence).toContain("bishop on c4 protects f7");
        expect(result.missedMotifs[0].evidence).toContain("Nxd8, winning the queen");
    });

    test("keeps SAN-dependent explanation text distinct in the motif cache", () => {
        const input = {
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            bestMoveUci: "e5f7",
            pvUci: ["e5f7", "d7d5", "f7d8"],
            cpLoss: 400,
        };
        classifyMistakeReviewMotifs({
            ...input,
            pvSan: ["Nxf7", "d5", "Nxd8"],
        });
        const annotated = classifyMistakeReviewMotifs({
            ...input,
            pvSan: ["Nxf7!", "d5", "Nxd8+"],
        });

        expect(annotated.missedMotifs[0].evidence).toContain("Nxf7! forks");
        expect(annotated.missedMotifs[0].evidence).toContain("Nxd8+, winning the queen");
    });

    test("explains Bxf7+ as a protected two-against-one checking capture", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5",
            bestMoveUci: "c4f7",
            pvUci: ["c4f7", "e8f8", "f7b3"],
            pvSan: ["Bxf7+", "Kf8", "Bb3"],
            cpLoss: 400,
        });

        const weakF7 = result.missedMotifs.find((motif) => motif.id === "attackingF2F7");
        expect(weakF7).toMatchObject({ label: "Weak f7", moveUci: "c4f7" });
        expect(weakF7?.evidence).toContain("attacked twice and defended once");
        expect(weakF7?.evidence).toContain("gives check");
        expect(weakF7?.evidence).toContain("knight on e5 protects the bishop");
        expect(result.missedMotifs.map((motif) => motif.id)).not.toContain("defensiveMove");
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

    test("chooses an opponent fork as the causal why for an allowed tactic", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/8/8/1n6/8/8/R3K2R w KQ - 0 1",
            bestMoveUci: "e1d1",
            playedMoveUci: "h1h3",
            pvUci: ["e1d1", "b4c2", "d1c1"],
            refutationUci: ["b4c2", "e1d1", "c2a1"],
            refutationSan: ["Nc2+", "Kd1", "Nxa1"],
            cpLoss: 300,
        });

        expect(result.allowedMotifs[0]).toMatchObject({ id: "fork", source: "allowed" });
        expect(result.allowedMotifs[0].evidence).toContain("king on e1 and rook on a1");
        const explanation = buildMistakeReviewTacticalExplanation(result);
        expect(explanation).toMatchObject({
            title: "Why the move was tactically bad",
            source: "allowed",
        });
        expect(explanation?.text).toContain("Your move allowed this tactic: Nc2+");
    });

    test("names the loose piece won by an opponent refutation", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "4k3/8/7p/8/8/5N2/8/4K3 w - - 0 1",
            bestMoveUci: "e1f2",
            playedMoveUci: "f3g5",
            pvUci: ["e1f2", "e8f7"],
            refutationUci: ["h6g5"],
            refutationSan: ["hxg5"],
            cpLoss: 300,
        });

        const hanging = result.allowedMotifs.find((motif) => motif.id === "hangingPiece");
        expect(hanging?.evidence).toBe("hxg5 wins the loose knight on g5.");
    });

    test("keeps a verified pin as the primary missed tactical theme", () => {
        const result = classifyMistakeReviewMotifs({
            fen: "2r2rk1/pp4pp/1n3p2/3p4/3qp1N1/6Q1/P1P3PP/1N2R2K w - - 4 21",
            bestMoveUci: "g4h6",
            pvUci: ["g4h6", "g8h8", "h6f5", "f8f7", "f5d4"],
            pvSan: ["Nh6", "Kh8", "Nf5", "Rf7", "Nxd4"],
            cpLoss: 300,
        });

        expect(result.missedMotifs[0]).toMatchObject({ id: "pin", label: "Pin" });
        expect(result.missedMotifs[0].evidence).toMatch(/pin the .* on .* to the .* on/);
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
