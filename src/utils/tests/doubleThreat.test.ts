import { expect, test } from "vitest";
import { proveQuietDoubleThreat, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";

const fen = "r5k1/5p2/Br2p1p1/1PNpPb1q/3P4/4P1Q1/5K1P/6R1 w - - 0 33";
const line = ["c5d7", "g8g7", "d7b6"];

test("Nd7's rook attack and checking fork jointly beat every legal defence", () => {
    const proof = proveQuietDoubleThreat(replayTacticalLine(fen, line)[0]);
    expect(proof).not.toBeNull();
    expect(proof?.branches).toContainEqual({ reply: "Kg7", answer: "Nxb6", kind: "capture" });
    expect(proof?.branches).toContainEqual({ reply: "Rb7", answer: "Nf6+", kind: "fork" });
});

test.each([line, ["c5d7", "b6b7", "d7f6", "g8f8", "f6h5"], ["c5d7"]])(
    "the root double threat does not depend on a cooperative PV: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "doubleThreat", ply: 1 });
        expect(result.motifs[0].evidence).toContain("rook on b6");
        expect(result.motifs[0].evidence).toContain("queen on h5");
        expect(result.timeline?.filter((m) => m.ply === 1 && m.id === "fork")).toEqual([]);
    },
);

test("the board draws the real rook attack, not a future knight on f6", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: ["c5d7"],
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.motifs[0].id).toBe("doubleThreat");
    expect(scan.labels[0].text).toContain("Double Threat");
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["c5d7", "d7b6"]);
});

test("the actual checking fork remains secondary at ply three", () => {
    const result = classifyPositionTacticalMotifs({
        fen,
        pvUci: ["c5d7", "b6b7", "d7f6", "g8f8", "f6h5"],
    });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 3, relevance: "secondary" }),
    );
});

test.each([
    ["no queen to fork", fen.replace("1PNpPb1q", "1PNpPb2")],
    ["a knight can capture Nd7", fen.replace("Br2p1p1", "Br2pnp1")],
    ["a pawn can capture Nf6", fen.replace("5p2", "4pp2")],
])("does not turn %s into an unavoidable double threat", (_name, position) => {
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(3);
    expect(proveQuietDoubleThreat(steps[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: line }).motifs.some(
            (m) => m.id === "doubleThreat",
        ),
    ).toBe(false);
});

test("a warm cache does not override an explicitly exhausted proof budget", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveQuietDoubleThreat(root)).not.toBeNull();
    expect(proveQuietDoubleThreat(root, 0)).toBeNull();
});

test("the negative controls contain actual legal captures, not just changed geometry", () => {
    expect(replayTacticalLine(fen.replace("Br2p1p1", "Br2pnp1"), ["c5d7", "f6d7"])).toHaveLength(2);
    expect(
        replayTacticalLine(fen.replace("5p2", "4pp2"), ["c5d7", "b6b7", "d7f6", "e7f6"]),
    ).toHaveLength(4);
});

test("irrelevant pawn moves cannot relabel the same existing double threat as newly allowed", () => {
    const position = fen.replace("5p2", "p4p2").replace("Br2p1p1", "1r2p1p1").replace(" w ", " b ");
    // Both lines lose the exchange, matching the proof's minimum. A
    // cooperative Kg7 line losing a whole rook must not be equated to that.
    const defence = ["c5d7", "b6b8", "d7b8", "a8b8"];
    const result = classifyMistakeReviewMotifs({
        fen: position,
        playedMoveUci: "a7a6",
        bestMoveUci: "a7a5",
        refutationUci: defence,
        pvUci: ["a7a5", ...defence],
    });
    expect(result.allowedMotifs[0]).toMatchObject({ id: "doubleThreat", comparison: "persists" });
    expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
        "does not explain the difference",
    );
});
