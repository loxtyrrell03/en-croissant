import { describe, expect, test } from "vitest";
import { replayTacticalLine, tacticalBoardEvidence } from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const forced = "3r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24";
const escape = "3r2k1/p4pp1/1p5p/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24";
const pinned = "R2r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 0 24";
const line = ["e4e8", "d8e8", "f3d5"];

describe("deflection requires a real defender and a forcing consequence", () => {
    test("declining the queen loss can instead allow a verified immediate mate", () => {
        const fen = "6k1/6b1/5nPB/3q4/4R3/5Q2/5PPP/6K1 w - - 0 1";
        const declined = replayTacticalLine(fen, ["e4e8", "g7f8", "e8f8"]);
        expect(declined).toHaveLength(3);
        expect(declined[2].after.isCheckmate()).toBe(true);
        const result = classifyPositionTacticalMotifs({ fen, pvUci: ["e4e8", "f6e8", "f3d5"] });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", confidence: "high" });
        expect(result.motifs[0].evidence).toContain("or immediate mate");
    });
    test("identifies the rook drawn away from the queen", () => {
        expect(replayTacticalLine(forced, line)).toHaveLength(3);
        const result = classifyPositionTacticalMotifs({ fen: forced, pvUci: line });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1, moveUci: "e4e8" });
        expect(result.motifs[0].evidence).toContain("rook");
        expect(result.motifs[0].evidence).toContain("queen");
        expect(tacticalBoardEvidence(forced, line, result.motifs[0])).toEqual({
            square: "e8",
            arrows: [
                { from: "d8", to: "e8" },
                { from: "f3", to: "d5" },
            ],
        });
        expect(tacticalBoardEvidence(escape, line, result.motifs[0])).toBeNull();
    });

    test("a cooperative rook capture does not prove deflection when the king can escape", () => {
        expect(replayTacticalLine(escape, line)).toHaveLength(3);
        expect(replayTacticalLine(escape, ["e4e8", "g8h7"])).toHaveLength(2);
        expect(
            classifyPositionTacticalMotifs({ fen: escape, pvUci: line }).motifs.map((m) => m.id),
        ).not.toContain("deflection");
    });

    test("an already pinned pseudo-defender is not the cause of the queen's vulnerability", () => {
        expect(replayTacticalLine(pinned, line)).toHaveLength(3);
        const result = classifyPositionTacticalMotifs({ fen: pinned, pvUci: line });
        expect(result.motifs.map((m) => m.id)).not.toContain("deflection");
        // The rook battery forces Rxe8 Raxe8#. Taking the queen in the
        // supplied PV forgoes that mate; its discovery is not the root lesson.
        expect(result.motifs[0]).toMatchObject({ id: "mateIn2", label: "Forcing Mate", ply: 1 });
    });

    test("an incidental queen attack cannot borrow the value of the rook battery's mate", () => {
        const result = classifyPositionTacticalMotifs({
            fen: pinned,
            pvUci: ["e4e8", "d8e8", "a8e8"],
        });
        expect(result.motifs[0]).toMatchObject({ id: "mateIn2", ply: 1, label: "Forcing Mate" });
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "backRankMate", ply: 3 }),
        );
        expect(result.motifs.map((m) => m.id)).not.toContain("discoveredAttack");
    });
});
