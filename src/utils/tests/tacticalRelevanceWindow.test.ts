import { describe, expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    isCompensatedContinuationCapture,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildTacticalTimeline,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const fen = "rnbqk2r/p1ppbppp/1p3n2/4N3/2B5/4P3/PPPP1PPP/RNBQK2R w KQkq - 0 5";

describe("keep continuation lessons connected to the starting tactic", () => {
    test("moving a piece again clears its old capture-square credit", () => {
        const steps = replayTacticalLine(fen, ["e5f7", "d7d5", "f7d8", "d5c4", "d8b7", "c8b7"]);
        expect(steps).toHaveLength(6);
        expect(isCompensatedContinuationCapture(steps, 5)).toBe(false);
    });

    test("promotion gains count when a capturing pawn is later recaptured", () => {
        const steps = replayTacticalLine("r6r/5nP1/6k1/8/8/8/6PP/6K1 w - - 0 1", [
            "g7h8q",
            "a8a1",
            "g1f2",
            "f7h8",
        ]);
        expect(steps).toHaveLength(4);
        expect(isCompensatedContinuationCapture(steps, 3)).toBe(true);
    });
    test("a distant engine capture after quiet development is not part of the f7 lesson", () => {
        const pvUci = [
            "c4f7",
            "e8f8",
            "f7b3",
            "c7c5",
            "d2d4",
            "c8b7",
            "e1g1",
            "d7d5",
            "c2c4",
            "d5c4",
            "b3c4",
            "d8c7",
            "b1c3",
            "b8c6",
            "c3d5",
            "f6d5",
            "c4d5",
            "c6e5",
            "d4e5",
            "b7d5",
        ];
        const steps = replayTacticalLine(fen, pvUci);
        expect(steps).toHaveLength(pvUci.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]?.id).toBe("attackingF2F7");
        expect(result.timeline?.some((m) => (m.ply ?? 0) > 4)).toBe(false);
        // Navigating to that later position must still assess its own tactic.
        const later = classifyPositionTacticalMotifs({
            fen: makeFen(steps[17].before.toSetup()),
            pvUci: pvUci.slice(17),
        });
        expect(later.motifs.length).toBeGreaterThan(0);
    });

    test("a delayed recapture of the knight which won a queen is not a newly hanging knight", () => {
        const pvUci = ["e5f7", "d7d5", "f7d8", "d5c4", "b2b3", "e7d8"];
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 3 }),
        );
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 4 }),
        );
        expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 6)).toBe(false);
    });

    test("a queen which only took a pawn does not get exchange credit for its delayed loss", () => {
        const position = "r5k1/8/8/2n5/4p3/8/4Q1PP/6K1 w - - 0 1";
        const line = ["e2e4", "a8a1", "g1f2", "c5e4"];
        expect(replayTacticalLine(position, line)).toHaveLength(4);
        expect(buildTacticalTimeline(position, line, "available", [])).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 4, actor: "black" }),
        );
    });

    test("the same line-opening is not additionally called a clearance sacrifice", () => {
        const result = classifyPositionTacticalMotifs({
            fen: "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1",
            pvUci: ["e4h7", "g8f8", "e1e8", "f8e8"],
        });
        expect(result.timeline?.filter((m) => m.ply === 1).map((m) => m.id)).toEqual([
            "discoveredAttack",
        ]);
    });
});
