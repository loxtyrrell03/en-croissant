import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseSquare } from "chessops/util";
import {
    proveCaptureForkPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "5r1k/6pp/8/8/4n3/5NPQ/4Bq1P/4R2K b - - 0 1";
const line = ["f2e1", "f3e1", "e4f2", "h1g2", "f2h3", "e1f3", "f8f3", "e2f3", "h3g5"];

test("a capture clears an occupied square for the checking fork", () => {
    const errors: string[] = [];
    const proof = proveCaptureForkPreparation(replayTacticalLine(fen, line)[0], 4096, (reason) =>
        errors.push(reason),
    );
    expect({ proof, errors }).toMatchObject({
        proof: { gain: 180, branches: [{ vacatedForkSquare: parseSquare("f2"), answer: "Nf2+" }] },
        errors: [],
    });
    expect(classifyPositionTacticalMotifs({ fen, pvUci: line }).motifs[0]).toMatchObject({
        id: "forkPreparation",
        ply: 1,
    });
});

test("every accepting and declining defence has a legal witness", () => {
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveCaptureForkPreparation(root)!;
    const branches = [...proof.branches, ...proof.declined, ...(proof.otherCaptures ?? [])];
    const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
        [...dests].map((to) => makeSan(root.after, { from, to })),
    );
    expect(branches.map((b) => b.reply).sort()).toEqual(replies.sort());
    expect(replies).toHaveLength(5);
    for (const branch of branches) {
        const pos = root.after.clone();
        for (const san of [branch.reply, branch.answer]) {
            const move = parseSan(pos, san)!;
            expect(move).toBeDefined();
            expect(pos.isLegal(move)).toBe(true);
            pos.play(move);
        }
    }
    expect(root.before.isLegal({ from: parseSquare("e4")!, to: parseSquare("f2")! })).toBe(false);
});

test.each([line, [line[0]], [line[0], "h1g2", "e1a1"]].map((pvUci) => ({ pvUci })))(
    "clearance is independent of the displayed continuation: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 180 });
        expect(result.motifs[0].evidence).toContain("clearing f2 for a checking fork");
        expect(result.motifs[0].evidence).toContain("could not be played first");
        expect(result.motifs.some((m) => m.id === "sacrifice" || m.id === "clearance")).toBe(false);
    },
);

test.each([
    ["a rook can capture the forker", "5r1k/6pp/8/8/4n3/5NPQ/4BqRP/4R2K b - - 0 1"],
    ["the smaller victim cannot repay the offer", "5r1k/6pp/8/8/4n3/5NPR/4Bq1P/4R2K b - - 0 1"],
    ["the knight is absent", "5r1k/6pp/8/8/8/5NPQ/4Bq1P/4R2K b - - 0 1"],
    ["the fork square was already empty", "5r1k/6pp/8/8/4n3/5NPQ/3qB2P/4R2K b - - 0 1"],
])("no preparation certificate when %s", (_name, board) => {
    const root = replayTacticalLine(board, [
        _name === "the fork square was already empty" ? "d2e1" : line[0],
    ])[0];
    expect(root).toBeDefined();
    expect(proveCaptureForkPreparation(root)).toBeNull();
});

test("invalid and exhausted budgets cannot borrow a cached success", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveCaptureForkPreparation(root)).not.toBeNull();
    for (const limit of [0, 1, -1, 1.5, NaN, Infinity])
        expect(proveCaptureForkPreparation(root, limit)).toBeNull();
});

test("the primary, board and actual-ply fork agree without a free-queen badge", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.labels[0].text).toBe("Fork Preparation");
    expect(tacticalBoardEvidence(fen, line, result.motifs[0])).toEqual({
        square: "e1",
        arrows: [{ from: "e1", to: "h1" }],
    });
    expect(scan.arrows.some((a) => a.from === "f2" && a.to === "h3")).toBe(false);
});

test("matching acceptance history suppresses a false gain but missing history does not", () => {
    const root = replayTacticalLine(fen, line)[0];
    const accepted = classifyPositionTacticalMotifs({
        fen: makeFen(root.after.toSetup()),
        pvUci: line.slice(1),
        previousFen: fen,
        previousMoveUci: line[0],
    });
    expect(accepted.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
    const withoutHistory = classifyPositionTacticalMotifs({
        fen: makeFen(root.after.toSetup()),
        pvUci: line.slice(1),
    });
    expect(withoutHistory.motifs.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(true);
});

test("mistake review names the missed preparation instead of the conditional fork", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        pvUci: line,
        bestMoveUci: line[0],
        playedMoveUci: "h7h6",
    });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        primary: { id: "forkPreparation", source: "missed", ply: 1 },
    });
    expect(result.missedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("moving the queen onto the fork's target allows the preparation", () => {
    const before = "5r1k/6pp/8/8/4n1Q1/5NP1/4Bq1P/4R2K w - - 0 1";
    const result = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "g4h4",
        playedMoveUci: "g4h3",
        pvUci: ["g4h4"],
        refutationUci: line,
    });
    expect(result.allowedMotifs[0]).toMatchObject({
        id: "forkPreparation",
        comparison: "prevented",
    });
    expect(buildMistakeReviewTacticalExplanation(result)).toMatchObject({
        primary: { id: "forkPreparation", source: "allowed" },
    });
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("winning the loose forker is the main missed lesson and the allowed preparation stays secondary", () => {
    const before = "5r1k/6pp/8/8/4n1Q1/5NP1/4Bq1P/4R2K w - - 0 1";
    // Fresh depth-16 evidence: Qxe4 is +560 cp for White; Qh3 is -5 cp.
    // Qh4 only prevents this particular fork and is itself near equality.
    const result = classifyMistakeReviewMotifs({
        fen: before,
        bestMoveUci: "g4e4",
        playedMoveUci: "g4h3",
        pvUci: [
            "g4e4",
            "f2c5",
            "e2c4",
            "g7g6",
            "g3g4",
            "f8c8",
            "c4d5",
            "c5c3",
            "e4d4",
            "c3d4",
            "f3d4",
        ],
        refutationUci: line,
        cpBefore: 560,
        cpAfter: -5,
        cpLoss: 565,
    });
    const explanation = buildMistakeReviewTacticalExplanation(result);
    expect(explanation?.primary).toMatchObject({ id: "hangingPiece", source: "missed", ply: 1 });
    expect(explanation?.secondary).toMatchObject({
        id: "forkPreparation",
        source: "allowed",
        comparison: "prevented",
        ply: 1,
    });
    expect(explanation?.text).toContain("also allowed an opponent tactic (Fork Preparation)");
    expect(result.allowedTimeline).toContainEqual(expect.objectContaining({ id: "fork", ply: 3 }));
});

test("colour reflection retains the square-clearing lesson", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const result = classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected });
    expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", value: 180 });
    expect(result.motifs[0].evidence).toContain("clearing f7");
});

test.skipIf(!process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE)(
    "the real course preparation gains the same independent root proof",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_FOURTH_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 57);
        for (const pvUci of [[row.sourceUci[0]], row.sourceUci]) {
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
            expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 180 });
        }
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "the non-checking course capture also explains why the offered queen cannot be taken",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 126);
        const root = replayTacticalLine(row.fen, row.sourceUci)[0];
        expect(root.after.isCheck()).toBe(false);
        const proof = proveCaptureForkPreparation(root)!;
        expect(proof).toMatchObject({
            gain: 320,
            branches: [{ vacatedForkSquare: parseSquare("e3"), answer: "Ne3+" }],
        });
        const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
            [...dests].map((to) => makeSan(root.after, { from, to })),
        );
        expect(
            [...proof.branches, ...proof.declined, ...(proof.otherCaptures ?? [])]
                .map((b) => b.reply)
                .sort(),
        ).toEqual(replies.sort());
        for (const pvUci of [[row.sourceUci[0]], row.sourceUci]) {
            const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci });
            expect(result.motifs[0]).toMatchObject({ id: "forkPreparation", ply: 1, value: 320 });
            expect(result.motifs[0].evidence).toContain("clearing e3");
        }
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            bestMoveUci: row.sourceUci[0],
            playedMoveUci: "a5a4",
            pvUci: row.sourceUci,
        });
        expect(buildMistakeReviewTacticalExplanation(review)?.primary).toMatchObject({
            id: "forkPreparation",
            source: "missed",
            ply: 1,
        });
        expect(review.missedTimeline).toContainEqual(
            expect.objectContaining({ id: "fork", ply: 3 }),
        );
    },
);
