import { expect, test } from "vitest";
import { provePromotionBackedFork, replayTacticalLine } from "@/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

// Real development case CSh8J: the knight on b6 also guards c8.
const fen = "8/2P5/1n3k2/p7/P7/4NKp1/8/8 w - - 5 65";
const line = ["e3d5", "b6d5", "c7c8q"];

test.each([line, ["e3d5", "f6e6", "d5b6"], ["e3d5"]])(
    "promotion-backed fork does not depend on the supplied defensive branch: %j",
    (...pvUci) => {
        const steps = replayTacticalLine(fen, pvUci);
        expect(steps).toHaveLength(pvUci.length);
        const proof = provePromotionBackedFork(steps[0]);
        expect(proof).toMatchObject({ gain: 320, pawn: 50, promotion: 58, defenders: [41] });
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({
            id: "fork",
            ply: 1,
            value: 320,
            confidence: "high",
        });
        expect(result.motifs[0].evidence).toContain("Nxd5 c8=Q");
        expect(result.motifs[0].evidence).toContain("knight on b6");
    },
);

test("promotion is the later payoff, not a replacement for the root fork", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 1, relevance: "primary" }),
    );
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "promotion", ply: 3 }));
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Regression", depth: 16 });
    expect(scan.motifs[0].id).toBe("fork");
    expect(scan.arrows.map((a) => `${a.from}${a.to}`)).toEqual(
        expect.arrayContaining(["e3d5", "d5b6", "d5f6", "b6c8", "c7c8"]),
    );
    expect(scan.labels).toContainEqual(expect.objectContaining({ text: "Fork", square: "d5" }));
});

test.each([
    ["no promoting pawn", "8/8/1n3k2/p7/P7/4NKp1/8/8 w - - 5 65"],
    ["a second guard can take the promoted queen", "7r/2P5/1n3k2/p7/P7/4NKp1/8/8 w - - 5 65"],
    [
        "an unrelated promotion cannot rescue an unsound fork",
        "8/7P/1n3k2/p7/P7/4NKp1/8/8 w - - 5 65",
    ],
])("reject the cooperative king-move line: %s", (_name, position) => {
    const pvUci = ["e3d5", "f6e6", "d5b6"];
    const steps = replayTacticalLine(position, pvUci);
    expect(steps).toHaveLength(3);
    expect(provePromotionBackedFork(steps[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci }).motifs.map((m) => m.id),
    ).not.toContain("fork");
});

test("the same promotion-backed fork works for Black", () => {
    const position = "8/8/1Pkn4/7p/7P/2K3N1/5p2/8 b - - 5 65";
    const pvUci = ["d6e4", "g3e4", "f2f1q"];
    const steps = replayTacticalLine(position, pvUci);
    expect(steps).toHaveLength(3);
    expect(provePromotionBackedFork(steps[0])?.gain).toBe(320);
    expect(classifyPositionTacticalMotifs({ fen: position, pvUci }).motifs[0]).toMatchObject({
        id: "fork",
        value: 320,
    });
});
