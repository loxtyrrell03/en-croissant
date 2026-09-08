import { expect, test } from "vitest";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import {
    proveTrappedMaterial,
    replayTacticalLine,
    tacticalBoardEvidence,
    tacticalExchangeGain,
} from "@/utils/tacticalMotifs/causalTactics";

const trapped = "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17";
const escape = "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/R3K2R b KQk - 0 17";
const line = ["c2b2", "e1g1", "b2a1"];

test("a bounded trap proof abstains instead of returning a cached or incomplete answer", () => {
    const root = replayTacticalLine(trapped, line)[0];
    expect(proveTrappedMaterial(root, 0)?.gain).toBe(830);
    expect(proveTrappedMaterial(root, 0, 0)).toBeNull();
    expect(proveTrappedMaterial(root, 0, 256, 0)).toBeNull();
});

test("the pin on the defender is not duplicated as a trapped-queen badge", () => {
    const fen = "4k2r/3nbppp/8/4p3/4P3/2Q5/Pq3PPP/RN2K2R b KQk - 1 18";
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["e7b4", "c3b4", "b2b4"] });
    expect(result.motifs[0]?.id).toBe("pin");
    expect(result.motifs.map((m) => m.id)).not.toContain("trappedPiece");
});

test("the trapped rook is the main lesson, with the bishop capture as supporting evidence", () => {
    const result = classifyPositionTacticalMotifs({ fen: trapped, pvUci: line });
    expect(result.motifs[0]).toMatchObject({
        id: "trappedPiece",
        label: "Trapped Rook",
        ply: 1,
        value: 830,
    });
    expect(result.motifs[0].evidence).toContain("Qc3 is answered by Bb4");
    expect(result.motifs).toContainEqual(
        expect.objectContaining({ id: "hangingPiece", relevance: "secondary" }),
    );
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "hangingPiece", ply: 3 }));
    expect(tacticalBoardEvidence(trapped, line, result.motifs[0])).toEqual({
        square: "a1",
        arrows: [{ from: "b2", to: "a1" }],
    });
});

test("a rook with a safe flight is not trapped despite the same cooperative PV", () => {
    expect(replayTacticalLine(escape, ["c2b2", "a1d1"])).toHaveLength(2);
    const result = classifyPositionTacticalMotifs({ fen: escape, pvUci: line });
    expect(result.motifs[0]?.id).toBe("hangingPiece");
    expect(result.motifs.map((m) => m.id)).not.toContain("trappedPiece");
});

test("a larger immediate queen win remains primary over the additional trapped rook", () => {
    const fen = "4k2r/3nbppp/8/4p3/4P3/8/PQq2PPP/RN2K2R b KQk - 0 17";
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "hangingPiece", value: 900 });
    expect(result.motifs).toContainEqual(
        expect.objectContaining({ id: "trappedPiece", relevance: "secondary", value: 1400 }),
    );
});

test("an actual defending resource refutes the trap if the pinning bishop is absent", () => {
    const fen = "4k2r/3n1ppp/8/4p3/4P3/4Q3/PBq2PPP/RN2K2R b KQk - 0 17";
    const defence = replayTacticalLine(fen, ["c2b2", "e3c3", "b2a1"]);
    expect(defence).toHaveLength(3);
    expect(tacticalExchangeGain(defence[2].before, defence[2].move)).toBe(-400);
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs.map((m) => m.id),
    ).not.toContain("trappedPiece");
});

test("the proof retains a king attack whose victim's best escape is an exchange sacrifice", () => {
    const fen = "8/4kp1p/2N2p2/1bRp4/8/2P4P/Pr4PK/8 b - - 0 41";
    const pvUci = ["e7d6", "c5b5", "b2b5"];
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(3);
    expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]).toMatchObject({
        id: "trappedPiece",
        label: "Trapped Rook",
        value: 170,
        confidence: "high",
    });
});

test("mistake review identifies the move that leaves the rook boxed in", () => {
    const result = classifyMistakeReviewMotifs({
        fen: trapped.replace(" b KQk", " w KQk"),
        playedMoveUci: "h2h3",
        bestMoveUci: "b1c3",
        pvUci: ["b1c3", "c2b2", "a1d1"],
        refutationUci: ["c2b2", "e1g1", "b2a1"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "trappedPiece", comparison: "prevented" });
    expect(result.allowedMotifs[0].comparisonEvidence).toContain("Rb1 saves the rook");
    expect(
        replayTacticalLine(trapped.replace(" b KQk", " w KQk"), [
            "b1c3",
            "c2b2",
            "a1b1",
            "b2b1",
            "c3b1",
        ]),
    ).toHaveLength(5);
});

test("the bishop cannot claim a pin after the king has castled off its line", () => {
    const fen = "4k2r/3nbppp/8/4p3/4P3/4Q3/PBq2PPP/RN3RK1 b k - 1 17";
    const pvUci = ["c2b2", "e3c3", "e7b4", "c3b2"];
    expect(replayTacticalLine(fen, pvUci)).toHaveLength(4);
    expect(
        classifyPositionTacticalMotifs({ fen, pvUci: ["c2b2"] }).motifs.map((m) => m.id),
    ).not.toContain("trappedPiece");
});

test("a different move that leaves the same trap does not count as preventing it", () => {
    const result = classifyMistakeReviewMotifs({
        fen: trapped.replace(" b KQk", " w KQk"),
        playedMoveUci: "h2h3",
        bestMoveUci: "h2h4",
        pvUci: ["h2h4", "c2b2"],
        refutationUci: ["c2b2", "e1g1", "b2a1"],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "trappedPiece", comparison: "persists" });
});
