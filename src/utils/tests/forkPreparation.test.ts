import { expect, test } from "vitest";
import {
    proveCheckingForkPreparation,
    replayTacticalLine,
} from "@/utils/tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "@/utils/tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "@/utils/tacticalMotifs/liveTactics";

const fen = "8/7R/5kp1/2R2p2/5n2/7P/1r6/5K2 b - - 1 45";
const line = ["b2b1", "f1f2", "f4d3", "f2f3", "d3c5"];

test("Rb1+ prepares the checking fork while also winning against the rook block", () => {
    expect(proveCheckingForkPreparation(replayTacticalLine(fen, line)[0])).toMatchObject({
        gain: 500,
        branches: expect.arrayContaining([
            { reply: "Kf2", answer: "Nd3+", kind: "fork", targets: ["king on f2", "rook on c5"] },
            { reply: "Rc1", answer: "Rxc1+", kind: "block", targets: [] },
        ]),
    });
});

test.each([line, ["b2b1", "c5c1", "b1c1"]])(
    "the root lesson survives either defensive branch: %j",
    (...pvUci) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 500 });
        expect(result.motifs[0].evidence).toContain("Blocking with Rc1 instead allows Rxc1+");
    },
);

test("a single root move is enough to discover the preparation and its actual checking arrow", () => {
    const scan = buildLiveTacticalScan({
        fen,
        pvUci: ["b2b1"],
        depth: 16,
        engineName: "Regression",
    });
    expect(scan.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(scan.labels[0].text).toContain("Fork Preparation");
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(["b2b1", "b1f1"]);
});

test("the fork and capture stay at their actual plies", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(
        expect.objectContaining({ id: "fork", ply: 3, relevance: "secondary" }),
    );
    expect(result.timeline?.find((m) => m.id === "fork" && m.ply === 1)).toBeUndefined();
});

test.each([
    ["capturing the checker", fen.replace("1r6", "1r1N4"), "d2b1"],
    ["capturing the forking knight", fen.replace("1r6", "1r2P3"), "e2d3"],
])("a cooperative fork does not hide %s", (_name, position, defence) => {
    const steps = replayTacticalLine(position, line);
    expect(steps).toHaveLength(5);
    const prefix = defence === "d2b1" ? [line[0], defence] : [...line.slice(0, 3), defence];
    expect(replayTacticalLine(position, prefix)).toHaveLength(prefix.length);
    expect(proveCheckingForkPreparation(steps[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: line }).motifs.some(
            (m) => m.id === "forkPreparation",
        ),
    ).toBe(false);
});

test("a cached proof cannot bypass an exhausted budget", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveCheckingForkPreparation(root)).not.toBeNull();
    expect(proveCheckingForkPreparation(root, 0)).toBeNull();
});

test("a checking castle cannot dereference the vacated rook square as a checking piece", () => {
    const steps = replayTacticalLine("3k4/8/8/8/8/8/8/R3K3 w Q - 0 1", ["e1a1"]);
    expect(steps).toHaveLength(1);
    expect(steps[0].after.isCheck()).toBe(true);
    expect(proveCheckingForkPreparation(steps[0])).toBeNull();
});

test("two unrelated pawn moves do not create different causes for the same existing preparation", () => {
    const result = classifyMistakeReviewMotifs({
        fen: fen.replace("1r6", "Pr6").replace(" b ", " w "),
        playedMoveUci: "a2a3",
        bestMoveUci: "a2a4",
        refutationUci: line,
        pvUci: ["a2a4", ...line],
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "persists",
    });
    expect(buildMistakeReviewTacticalExplanation(result)?.text).toContain(
        "does not explain the difference",
    );
});

test("a protected rook block prevents the checking preparation from claiming a forced win", () => {
    const position = fen.replace("2R2p2", "4Rp2");
    const cooperative = [...line.slice(0, 4), "d3e5"];
    expect(replayTacticalLine(position, cooperative)).toHaveLength(5);
    expect(replayTacticalLine(position, ["b2b1", "e5e1", "b1e1", "f1e1"])).toHaveLength(4);
    expect(proveCheckingForkPreparation(replayTacticalLine(position, cooperative)[0])).toBeNull();
});
