import { describe, expect, test } from "vitest";
import {
    proveDiscoveredMaterial,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

describe("discovered threats must cause the gain", () => {
    test.each([
        {
            name: "bishop checks while uncovering a rook attack on the queen",
            fen: "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1",
            line: ["e4h7", "g8h7", "e1e8"],
            primary: "discoveredAttack",
        },
        {
            name: "rook attacks the queen while uncovering bishop check",
            fen: "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1",
            line: ["e5f5", "h8g8", "f5f8"],
            primary: "discoveredCheck",
        },
        {
            name: "double check is the mechanism of mate",
            fen: "3rkr2/5p2/8/8/8/8/4B3/4R1K1 w - - 0 1",
            line: ["e2b5"],
            primary: "doubleCheck",
        },
        {
            name: "the same discovered attack works for Black",
            fen: "4r1k1/5ppp/8/4b3/8/8/5PPP/4Q1K1 b - - 0 1",
            line: ["e5h2", "g1h2", "e8e1"],
            primary: "discoveredAttack",
        },
    ])("$name", ({ fen, line, primary }) => {
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.motifs[0]?.id).toBe(primary);
        expect(result.motifs[0]).toMatchObject({ ply: 1, moveUci: line[0], confidence: "high" });
        expect(result.motifs[0].evidence).toContain("uncovering");
        expect(
            result.motifs.filter((m) =>
                ["discoveredAttack", "discoveredCheck", "doubleCheck"].includes(m.id),
            ),
        ).toHaveLength(1);
        expect(result.timeline?.some((m) => m.id === "discoveredCheck" && m.ply === 3)).toBe(false);
    });

    test("a forced interposition and the king escape both have verified answers", () => {
        const fen = "5q1k/5p1p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1";
        const line = ["e5f5", "f7f6", "f5f6", "f8f6", "b2f6"];
        const root = replayTacticalLine(fen, line)[0];
        expect(proveDiscoveredMaterial(root)).toBeGreaterThanOrEqual(100);
        expect(proveDiscoveredMaterial(root, 0)).toBeNull();
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.motifs[0]).toMatchObject({ id: "discoveredCheck", ply: 1 });
        expect(result.motifs[0].evidence).toContain("one extra checking move");
        // Kg8 avoids the immediate pawn exchange, but Rg5+ forces a queen
        // block. Testing just the f6 PV would miss this required branch.
        const escape = replayTacticalLine(fen, ["e5f5", "h8g8", "f5g5", "f8g7", "g5g7"]);
        expect(escape).toHaveLength(5);
        expect(escape[4].capture).toBe(900);
    });

    test("an ordinary discovered check is not a material combination", () => {
        const fen = "7k/7p/7r/4R3/8/8/1B3PPP/6K1 w - - 0 1";
        const line = ["e5f5", "h8g8"];
        const root = replayTacticalLine(fen, line)[0];
        expect(root.after.isCheck()).toBe(true);
        expect(proveDiscoveredMaterial(root)).toBeNull();
        expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs).toEqual([]);
    });

    test("losing the bishop cannot be ignored when the exposed rook is defended", () => {
        const fen = "3rr1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1";
        const line = ["e4h7", "g8h8", "e1e8", "d8e8"];
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        expect(proveDiscoveredMaterial(replayTacticalLine(fen, line)[0])).toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs.some((m) => m.ply === 1),
        ).toBe(false);
    });

    test("the board shows the uncovered ray and the accompanying queen attack", () => {
        const fen = "5q1k/7p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1";
        const line = ["e5f5", "h8g8", "f5f8"];
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
            square: "f5",
            arrows: [
                { from: "b2", to: "h8" },
                { from: "f5", to: "f8" },
            ],
        });
    });

    test("short engine snapshots and mistake lessons retain the actual mechanism", () => {
        const fen = "5q1k/5p1p/8/4R3/8/8/1B3PPP/6K1 w - - 0 1";
        expect(classifyPositionTacticalMotifs({ fen, pvUci: ["e5f5"] }).motifs[0]).toMatchObject({
            id: "discoveredCheck",
            ply: 1,
        });
        const result = classifyMistakeReviewMotifs({
            fen,
            bestMoveUci: "e5f5",
            pvUci: ["e5f5", "f7f6", "f5f6", "f8f6", "b2f6"],
        });
        expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
            source: "missed",
            primary: { id: "discoveredCheck", ply: 1 },
        });
        expect(result.missedTimeline?.some((m) => m.id === "discoveredCheck" && m.ply === 3)).toBe(
            false,
        );
    });

    test("a cooperative queen loss does not prove a quiet discovered attack", () => {
        const fen = "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1";
        const line = ["e4f3", "g8h8", "e1e8"];
        expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
        // After Bf3, Qxe1# is legal. Kh8 is a cooperative alternative.
        expect(replayTacticalLine(fen, ["e4f3", "e8e1"])[1].after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
        expect(result.motifs.filter((m) => m.ply === 1)).toEqual([]);
    });
});
