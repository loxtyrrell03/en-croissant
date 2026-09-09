import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseSquare } from "chessops/util";
import { proveCaptureForkPreparation, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "4k3/7r/8/8/6pN/4r1P1/5RPK/8 b - - 0 1";
const line = ["h7h4", "g3h4", "g4g3", "h2g1", "g3f2", "g1f2"];
const root = () => replayTacticalLine(fen, line)[0];

test("a sacrifice clears the pawn's blocked advance to a checking fork", () => {
    expect(replayTacticalLine(fen, line)).toHaveLength(line.length);
    const proof = proveCaptureForkPreparation(root())!;
    expect(proof).toMatchObject({
        gain: 220,
        branches: [{ receiver: "pawn", clearedForkSquare: parseSquare("g3"), answer: "g3+" }],
    });
    expect(root().before.isLegal({ from: parseSquare("g4")!, to: parseSquare("g3")! })).toBe(false);
    expect(proof.branches[0].targets).toEqual(["rook on f2", "king on h2"]);
});

test("every root defence has a legal witness, including declining the sacrifice", () => {
    const step = root();
    const proof = proveCaptureForkPreparation(step)!;
    const replies = [...step.after.allDests()].flatMap(([from, dests]) =>
        [...dests].map((to) => makeSan(step.after, { from, to })),
    );
    const branches = [...proof.branches, ...proof.declined];
    expect(branches.map((b) => b.reply).sort()).toEqual(replies.sort());
    expect(proof.declined).toEqual([{ reply: "Kg1", answer: "Rh5" }]);
    for (const branch of branches) {
        const pos = step.after.clone();
        for (const san of [branch.reply, branch.answer]) {
            const move = parseSan(pos, san)!;
            expect(move).toBeDefined();
            expect(pos.isLegal(move)).toBe(true);
            pos.play(move);
        }
    }
});

test.each([line, [line[0]], [line[0], "h2g1", "h4h5"]].map((pvUci) => ({ pvUci })))(
    "the root lesson does not depend on cooperative acceptance: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 220 });
        expect(result.motifs[0].evidence).toContain("draw the pawn off g3");
        expect(result.motifs[0].evidence).toContain("After gxh4, g3+");
        expect(result.motifs[0].evidence).not.toContain("attract the pawn onto");
    },
);

test.each([
    ["no protecting rook", "4k3/7r/8/8/6pN/6P1/5RPK/8 b - - 0 1"],
    ["a bishop payoff is too small", "4k3/7r/8/8/6pN/4r1P1/5BPK/8 b - - 0 1"],
    ["no pawn forker", "4k3/7r/8/8/7N/4r1P1/5RPK/8 b - - 0 1"],
    ["the recapturing bishop can take the checking pawn", "4k3/7r/8/8/6pN/4r1B1/5RPK/8 b - - 0 1"],
    ["another bishop can capture the checking pawn", "1B2k3/7r/8/8/6pN/4r1P1/5RPK/8 b - - 0 1"],
])("abstain when %s", (_name, position) => {
    const steps = replayTacticalLine(position, [line[0]]);
    expect(steps).toHaveLength(1);
    expect(proveCaptureForkPreparation(steps[0])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: [line[0]] }).motifs.some(
            (m) => m.id === "forkPreparation",
        ),
    ).toBe(false);
});

test("exhausted and invalid budgets cannot borrow the default certificate", () => {
    expect(proveCaptureForkPreparation(root())).not.toBeNull();
    for (const budget of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(root(), budget)).toBeNull();
    expect(proveCaptureForkPreparation(root())).not.toBeNull();
});

test("colour reflection retains clearance and its actual gain", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 220 });
    expect(result.motifs[0].evidence).toContain("draw the pawn off g6");
});

test("the accepted offer is not free material and the fork stays at its actual ply", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.some((m) => m.id === "fork" && m.ply === 3)).toBe(true);
    expect(
        result.timeline?.filter(
            (m) => m.ply === 2 && ["hangingPiece", "winningRecapture"].includes(m.id),
        ),
    ).toEqual([]);
    const step = replayTacticalLine(fen, line)[2];
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(step.before.toSetup()),
            pvUci: line.slice(2),
        }).motifs[0].id,
    ).toBe("fork");
});

test("a missed opportunity names the preparation instead of a hypothetical future fork", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        pvUci: line,
        playedMoveUci: "e8d8",
        bestMoveUci: line[0],
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(review.missedMotifs[0].evidence).toContain("draw the pawn off g3");
});

test("current-board arrows do not draw a pawn fork from its future square", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.labels[0].text).toContain("Fork Preparation");
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("h7h4");
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("g3f2");
});

test("an opponent's preparation stays visible without inventing an unproved causal comparison", () => {
    const before = "4k3/7r/8/8/6pN/4r1P1/6PK/5R2 w - - 0 1";
    expect(replayTacticalLine(before, ["f1f2", ...line])).toHaveLength(line.length + 1);
    const review = classifyMistakeReviewMotifs({
        fen: before,
        playedMoveUci: "f1f2",
        bestMoveUci: "f1e1",
        pvUci: ["f1e1"],
        refutationUci: line,
    });
    expect(review.allowedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(review.allowedMotifs[0].comparison).toBeUndefined();
    expect(buildMistakeReviewTacticalExplanation(review)?.title).toBe("Tactic after the move");
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "the actual easy-course root and missed opportunity share the clearance proof",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        const row = report.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 31);
        const proof = proveCaptureForkPreparation(replayTacticalLine(row.fen, row.sourceUci)[0]);
        expect(proof).toMatchObject({ gain: 220 });
        for (const pvUci of [row.sourceUci, [row.sourceUci[0]], row.engineLines[0].pvUci]) {
            expect(classifyPositionTacticalMotifs({ fen: row.fen, pvUci }).motifs[0]).toMatchObject(
                { id: "forkPreparation", ply: 1 },
            );
        }
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            pvUci: row.sourceUci,
            playedMoveUci: "e8d8",
            bestMoveUci: row.sourceUci[0],
            refutationUci: [],
        });
        expect(review.missedMotifs[0].id).toBe("forkPreparation");
    },
);
