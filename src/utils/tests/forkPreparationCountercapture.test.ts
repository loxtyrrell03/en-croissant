import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import {
    proveCaptureForkPreparation,
    replayTacticalLine,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import type { TacticalMotifEvidence } from "../tacticalMotifs/types";

const fen = "8/4r1p1/p2k4/1bN5/5K2/5P2/6P1/1R6 w - - 0 1";
const line = ["c5a6", "b5a6", "b1b6", "d6d7", "b6a6"];

test("the forker can capture a counterattacker instead of continuing to guard the offer", () => {
    const failures: string[] = [];
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, line)[0], 8192, (why) =>
        failures.push(why),
    );
    expect(failures).toEqual([]);
    expect(proof?.declined).toContainEqual({
        reply: "Re1",
        answer: "Rxe1",
        countercaptured: "rook",
    });
    expect(proof?.declined).toContainEqual({
        reply: "Re2",
        answer: "Rxb5",
        countercaptured: "bishop",
    });
    expect(proof?.declined.find((d) => d.reply === "g5+")?.delayedForks).toContainEqual({
        acceptance: "Bxa6",
        fork: "Rb6+",
    });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
    });
});

test("delaying acceptance with a check does not turn the offered piece into free material", () => {
    const delayed = ["c5a6", "g7g5", "f4g3", "b5a6", "b1b6", "d6d7", "b6a6"];
    expect(replayTacticalLine(fen, delayed)).toHaveLength(delayed.length);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: delayed });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(result.timeline?.filter((m) => m.ply === 4 && m.id === "hangingPiece")).toEqual([]);
    expect(result.timeline?.some((m) => m.ply === 5 && m.id === "fork")).toBe(true);
});

test("every declined reply and delayed fork has a legal witness", () => {
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveCaptureForkPreparation(root)!;
    const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
        [...dests].map((to) => makeSan(root.after, { from, to })),
    );
    expect([...proof.branches, ...proof.declined].map((b) => b.reply).sort()).toEqual(
        replies.sort(),
    );
    for (const branch of [...proof.branches, ...proof.declined]) {
        const pos = root.after.clone();
        for (const san of [branch.reply, branch.answer]) {
            const move = parseSan(pos, san)!;
            expect(move).toBeDefined();
            expect(pos.isLegal(move)).toBe(true);
            pos.play(move);
        }
        const delayedBranches = "delayedForks" in branch ? (branch.delayedForks ?? []) : [];
        for (const delayed of delayedBranches) {
            const after = pos.clone();
            for (const san of [delayed.acceptance, delayed.fork]) {
                const move = parseSan(after, san)!;
                expect(move).toBeDefined();
                expect(after.isLegal(move)).toBe(true);
                after.play(move);
            }
            expect(after.isCheck()).toBe(true);
        }
    }
});

test("a supporting rook cannot certify a decline if it allows the offered knight to be pinned", () => {
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, line)[0])!;
    // Ra1 permits ...Ra7, pinning Na6 to Ra1; retain a different legal witness.
    expect(proof.declined.find((b) => b.reply === "Be2")?.answer).not.toBe("Ra1");
    expect(replayTacticalLine(fen, ["c5a6", "b5e2", "b1a1", "e7a7"])).toHaveLength(4);
});

test("absent or mismatched delayed-acceptance history cannot hide a loose piece", () => {
    const steps = replayTacticalLine(fen, ["c5a6", "g7g5", "f4g3", "b5a6"]);
    const motif: TacticalMotifEvidence = {
        id: "hangingPiece",
        label: "Hanging Piece",
        confidence: "high",
        source: "available",
        ply: 4,
        moveUci: "b5a6",
        evidence: "Loose knight",
    };
    expect(winningRecaptureEvidence(steps, 3, motif)).toBeNull();
    expect(winningRecaptureEvidence(steps.slice(1), 2, motif)).toEqual(motif);
    const broken = steps.map((step) => ({ ...step }));
    broken[0].after = steps[0].before;
    expect(winningRecaptureEvidence(broken, 3, motif)).toEqual(motif);
    const unrelated = steps.map((step) => ({ ...step }));
    unrelated[1].san = "g6";
    expect(winningRecaptureEvidence(unrelated, 3, motif)).toEqual(motif);
});

test.each([
    ["no rook forker", "8/4r1p1/p2k4/1bN5/5K2/5P2/6P1/8 w - - 0 1"],
    ["no attractive bishop", "8/4r1p1/p2k4/2N5/5K2/5P2/6P1/1R6 w - - 0 1"],
])("do not invent the preparation with %s", (_name, position) => {
    const root = replayTacticalLine(position, [line[0]])[0];
    expect(root).toBeDefined();
    expect(proveCaptureForkPreparation(root)).toBeNull();
});

test("budget exhaustion cannot borrow a cached proof", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
    for (const budget of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(root, budget)).toBeNull();
});

test.each([line, [line[0]], ["c5a6", "e7e1", "b1e1"]].map((pvUci) => ({ pvUci })))(
    "the root remains a preparation when acceptance is absent: $pvUci",
    ({ pvUci }) => {
        expect(replayTacticalLine(fen, pvUci)).toHaveLength(pvUci.length);
        expect(classifyPositionTacticalMotifs({ fen, pvUci }).motifs[0]).toMatchObject({
            id: "forkPreparation",
            ply: 1,
        });
    },
);

test("missed opportunity and current-board arrows use the root, not a future fork square", () => {
    const review = classifyMistakeReviewMotifs({
        fen,
        pvUci: line,
        playedMoveUci: "g2g4",
        bestMoveUci: line[0],
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.labels[0].text).toContain("Fork Preparation");
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("c5a6");
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("b6a6");
    const actualFork = replayTacticalLine(fen, line)[2];
    expect(
        classifyPositionTacticalMotifs({
            fen: makeFen(actualFork.before.toSetup()),
            pvUci: line.slice(2),
        }).motifs[0].id,
    ).toBe("fork");
});

test("colour reflection retains the preparation and delayed fork", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const delayed = ["c5a6", "g7g5", "f4g3", "b5a6", "b1b6", "d6d7", "b6a6"].map((m) =>
        m.replace(/[1-8]/g, (r) => String(9 - Number(r))),
    );
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: delayed });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1 });
    expect(result.timeline?.some((m) => m.ply === 4 && m.id === "hangingPiece")).toBe(false);
    expect(result.timeline?.some((m) => m.ply === 5 && m.id === "fork")).toBe(true);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_THIRD_REPORT)(
    "the course rook counterattack has a material-preserving capture",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_THIRD_REPORT!, "utf8"));
        const row = report.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 124);
        const failures: string[] = [];
        const proof = proveCaptureForkPreparation(
            replayTacticalLine(row.fen, row.sourceUci)[0],
            8192,
            (why) => failures.push(why),
        );
        expect(failures).toEqual([]);
        expect(proof).not.toBeNull();
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0],
        ).toMatchObject({ id: "forkPreparation", ply: 1 });
    },
);
