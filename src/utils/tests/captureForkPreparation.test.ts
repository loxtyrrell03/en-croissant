import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "8/8/6k1/5qpr/4N3/8/8/K6Q w - - 0 1";
const line = ["h1h5", "g6h5", "e4g3"];
test("a checking queen offer attracts the king to a profitable checking fork", () => {
    expect(replayTacticalLine(fen, line)).toHaveLength(3);
    expect(proveCaptureForkPreparation(replayTacticalLine(fen, line)[0])).toMatchObject({
        gain: 180,
    });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
    });
});

test("the checking fork belongs to the accepted continuation, not the root board", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0].evidence).toContain("After Kxh5, Ng3+");
    expect(result.motifs[0].evidence).toContain("Declining with");
    expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 3)).toBe(true);
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("h5g6");
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("g3f5");
});

test("root-only and declined-offer inputs retain the same independently verified preparation", () => {
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, line)[0])!;
    expect(proof.declined.length).toBeGreaterThan(0);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        value: 180,
    });
});

test.each([
    ["8/8/6k1/5q1r/4N3/8/8/K6Q w - - 0 1", "the queen can accept instead of the king"],
    ["8/8/6k1/5bpr/4N3/8/8/K6Q w - - 0 1", "a bishop payoff cannot recover the queen"],
    ["8/8/6k1/5qpr/8/8/8/K6Q w - - 0 1", "the missing knight cannot deliver a fork"],
    [
        "8/8/6k1/5qpb/4N3/8/8/K6Q w - - 0 1",
        "the smaller initial capture cannot cover the knight liability",
    ],
    [
        "8/8/6k1/5qpr/4N1B1/8/8/K6Q w - - 0 1",
        "capturing another attacker while evading the fork erases its profit",
    ],
] as const)("rejects an unsound offer: %s (%s)", (position, _reason) => {
    expect(replayTacticalLine(position, [line[0]])).toHaveLength(1);
    expect(proveCaptureForkPreparation(replayTacticalLine(position, [line[0]])[0])).toBeNull();
});

test("invalid and exhausted budgets abstain without borrowing the default cache", () => {
    const step = replayTacticalLine(fen, line)[0];
    expect(proveCaptureForkPreparation(step)).not.toBeNull();
    for (const budget of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(step, budget)).toBeNull();
    expect(proveCaptureForkPreparation(step)).not.toBeNull();
});

test("a missed sacrifice retains the root preparation lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        playedMoveUci: "a1b1",
        bestMoveUci: line[0],
        pvUci: line,
        refutationUci: [],
    });
    expect(result.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 180 });
});

test("colour reflection preserves both the preparation and material accounting", () => {
    const reflected = "k6q/8/8/4n3/5QPR/6K1/8/8 b - - 0 1";
    const result = classifyPositionTacticalMotifs({
        fen: reflected,
        pvUci: ["h8h4", "g3h4", "e5g6"],
    });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", value: 180, ply: 1 });
});

test("an unchanged preparation is not falsely blamed on an unrelated pawn move", () => {
    const before = "8/p7/6k1/5qpr/4N3/8/8/K6Q b - - 0 1";
    const review = classifyMistakeReviewMotifs({
        fen: before,
        playedMoveUci: "a7a6",
        bestMoveUci: "a7a5",
        pvUci: ["a7a5", ...line],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]?.id).toBe("forkPreparation");
    expect(["prevented", "reduced"]).not.toContain(review.allowedMotifs[0]?.comparison);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "private checking sacrifices prove the root, not a cooperative endpoint",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const index of [77, 97]) {
            const item = sample.cases.find(
                (p: { eligibleIndex: number }) => p.eligibleIndex === index,
            );
            expect(
                proveCaptureForkPreparation(replayTacticalLine(item.fen, item.sourceUci)[0]),
            ).toMatchObject({ gain: index === 77 ? 100 : 280 });
            expect(
                classifyPositionTacticalMotifs({ fen: item.fen, pvUci: item.sourceUci }).motifs[0],
            ).toMatchObject({ id: "forkPreparation", ply: 1 });
            expect(
                classifyPositionTacticalMotifs({ fen: item.fen, pvUci: item.sourceUci })
                    .motifs[0].evidence,
            ).not.toContain("bishop on d3");
        }
    },
);
