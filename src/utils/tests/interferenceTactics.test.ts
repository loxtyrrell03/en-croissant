import { describe, expect, test } from "vitest";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "@/utils/tacticalMotifs/causalTactics";

const forced = "3k4/1r5q/3PP3/8/8/8/8/K6Q w - - 0 1";
const undefended = "3k4/1r5q/4P3/8/8/8/8/K6Q w - - 0 1";
const line = ["e6e7", "d8c8", "h1h7"];

describe("interference must cause a gain against real defensive choices", () => {
    test("anchors the primary cause to the blocker, not the later queen capture", () => {
        expect(replayTacticalLine(forced, line)).toHaveLength(3);
        const result = classifyPositionTacticalMotifs({ fen: forced, pvUci: line });
        expect(result.motifs[0]).toMatchObject({
            id: "interference",
            ply: 1,
            moveUci: "e6e7",
            value: 300,
            confidence: "high",
        });
        expect(result.motifs[0].evidence).toContain("rook on b7");
        expect(result.motifs[0].evidence).toContain("queen on h7");
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "hangingPiece", ply: 3, actor: "white" }),
        );
        expect(tacticalBoardEvidence(forced, line, result.motifs[0])).toEqual({
            square: "e7",
            arrows: [
                { from: "b7", to: "e7" },
                { from: "h1", to: "h7" },
            ],
        });
    });

    test("taking the supported blocker loses material, without assuming the queen must fall", () => {
        const pvUci = ["e6e7", "b7e7", "d6e7", "h7e7"];
        const steps = replayTacticalLine(forced, pvUci);
        expect(steps).toHaveLength(4);
        expect(steps[3].balance).toBe(300); // Rook for two pawns, not a queen win.
        expect(classifyPositionTacticalMotifs({ fen: forced, pvUci }).motifs[0]).toMatchObject({
            id: "interference",
            ply: 1,
            value: 300,
        });
    });

    test("does not need a cooperative or long PV to prove the blocking move", () => {
        expect(
            classifyPositionTacticalMotifs({ fen: forced, pvUci: ["e6e7"] }).motifs[0],
        ).toMatchObject({ id: "interference", ply: 1 });
    });

    test("rejects the same cooperative line when Rxe7 safely removes the blocker", () => {
        expect(replayTacticalLine(undefended, line)).toHaveLength(3);
        const defence = replayTacticalLine(undefended, ["e6e7", "b7e7"]);
        expect(defence).toHaveLength(2);
        expect(tacticalExchangeGain(defence[1].before, defence[1].move)).toBe(100);
        expect(classifyPositionTacticalMotifs({ fen: undefended, pvUci: line }).motifs).toEqual([]);
        const motif = classifyPositionTacticalMotifs({ fen: forced, pvUci: line }).motifs[0];
        expect(tacticalBoardEvidence(undefended, line, motif)).toBeNull();
    });

    test("without check the queen has a stronger reply than allowing its capture", () => {
        const fen = "2k5/1r5q/3PP3/8/8/8/8/K6Q w - - 0 1";
        const cooperative = ["e6e7", "c8b8", "h1h7"];
        expect(replayTacticalLine(fen, cooperative)).toHaveLength(3);
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: cooperative }).motifs.map((m) => m.id),
        ).not.toContain("interference");
        const refutation = replayTacticalLine(fen, ["e6e7", "h7g7", "a1a2", "g7b2"]);
        expect(refutation).toHaveLength(4);
        expect(refutation[3].after.isCheckmate()).toBe(true);
    });

    test("does not credit cutting a rook that was already pinned", () => {
        const fen = "1k6/1r5q/3PP3/8/8/8/8/KR5Q w - - 0 1";
        const pvUci = ["e6e7", "b8c8", "h1h7"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci }).motifs.map((m) => m.id),
        ).not.toContain("interference");
    });

    test("the rook's pin enables the queen capture, not removing the queen as a defender", () => {
        const fen = "1k6/1r5q/3PP3/8/8/8/8/KR5Q w - - 0 1";
        const pvUci = ["h1h7", "b7b1", "a1b1"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]?.id).toBe("pin");
        expect(result.motifs.map((m) => m.id)).not.toContain("capturingDefender");
    });

    test("Black's mirrored interference gets the same factual cause and value", () => {
        const fen = "k6q/8/8/8/8/3pp3/1R5Q/3K4 b - - 0 1";
        const pvUci = ["e3e2", "d1c1", "h8h2"];
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "interference", ply: 1, value: 300 });
        expect(result.timeline?.[0].actor).toBe("black");
    });
});
