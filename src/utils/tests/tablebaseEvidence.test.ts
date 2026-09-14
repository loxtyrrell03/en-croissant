import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { tacticalBoardEvidence } from "../tacticalMotifs/causalTactics";
import { tablebaseCases } from "./fixtures/tablebaseRelevance";
import {
    proveTablebaseZugzwang,
    tablebaseZugzwangEvidence,
    tablebaseZugzwangRequests,
    validateTablebaseRecord,
    type TablebaseEvidence,
} from "../tacticalMotifs/tablebaseEvidence";

const receipt = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/cross-phase-tablebase-verified.json", "utf8"),
);
test.each([
    ["not a FEN", "a1a2"],
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e2e4"],
    ["4k3/8/8/8/8/8/8/4K2R w K - 0 1", "h1h2"],
    ["7k/8/8/3pP3/8/8/8/K7 w - d6 0 1", "a1b1"],
    ["k7/8/8/8/8/8/1R6/7K w - - 0 1", "b2a2"],
    ["8/8/6k1/8/4pK2/8/5P2/8 w - - 0 1", "f4e4"],
    ["7k/P7/2K5/8/8/8/8/8 w - - 0 1", "a7a8q"],
    ["k7/8/2K5/8/8/8/8/8 w - - 0 1", "c6c5"],
])("unverified eligibility/rights/check/terminal boundaries abstain: %s", (position, move) => {
    expect(tablebaseZugzwangRequests(position, move)).toBeNull();
});
const fen = receipt.queries.find((r: any) => r.id === "root").fen;
const evidence: TablebaseEvidence = {
    provider: "lichess-syzygy",
    records: receipt.queries.map((r: any) => ({ fen: r.fen, result: r.result })),
};

test("Kf4 is an outcome-changing six-piece zugzwang, not just low mobility", () => {
    for (const record of evidence.records)
        expect(validateTablebaseRecord(record, record.fen)).not.toBeNull();
    expect(proveTablebaseZugzwang(fen, "g4f4", evidence)).toMatchObject({
        outcome: "win",
        passedOutcome: 0,
        beneficiary: "white",
        defender: "black",
        pieceCount: 6,
    });
    expect(proveTablebaseZugzwang(fen, "g4f4", evidence)?.replies).toHaveLength(5);
    expect(tablebaseZugzwangEvidence(fen, "g4f4", evidence, "available")).toMatchObject({
        id: "zugzwang",
        ply: 1,
        moveUci: "g4f4",
        value: 0,
    });
});

test.each(["unknown", "maybe-win", "maybe-loss", "syzygy-win", "syzygy-loss"])(
    "uncertain %s cannot supply either side of the comparison",
    (category) => {
        const broken = structuredClone(evidence);
        (broken.records[1].result as any).category = category;
        expect(proveTablebaseZugzwang(fen, "g4f4", broken)).toBeNull();
    },
);

test.each([
    "missing",
    "duplicate",
    "illegal",
    "child-result",
    "parent-result",
    "terminal",
    "wrong-clock",
    "wrong-side",
    "missing-pass",
])("reject incomplete or inconsistent certificates: %s", (defect) => {
    const broken = structuredClone(evidence);
    const result = broken.records[1].result as any;
    if (defect === "missing") result.moves.pop();
    if (defect === "duplicate") result.moves[0] = result.moves[1];
    if (defect === "illegal") result.moves[0].uci = "a1a8";
    if (defect === "child-result") result.moves[0].category = "draw";
    if (defect === "parent-result") result.category = "win";
    if (defect === "terminal") result.stalemate = true;
    if (defect === "wrong-clock")
        broken.records[1].fen = broken.records[1].fen.replace("3 42", "4 42");
    if (defect === "wrong-side")
        broken.records[1].fen = broken.records[1].fen.replace(" b ", " w ");
    if (defect === "missing-pass") broken.records.splice(2, 1);
    expect(proveTablebaseZugzwang(fen, "g4f4", broken)).toBeNull();
});

test("an unknown alternative, a duplicate record and a claimable draw never reuse another certificate", () => {
    expect(proveTablebaseZugzwang(fen, "g4f3", evidence)).toBeNull();
    expect(
        proveTablebaseZugzwang(fen, "g4f4", {
            ...evidence,
            records: [...evidence.records, evidence.records[1]],
        }),
    ).toBeNull();
    expect(tablebaseZugzwangRequests(fen.replace("2 42", "98 42"), "g4f4")).toBeNull();
});

test("the six-piece certificate reaches primary, missed lesson and precise board geometry without future noise", () => {
    const input = {
        fen,
        pvUci: ["g4f4", "f6e6", "f4e4", "e6d6", "e4f5"],
        tablebaseEvidence: evidence,
    };
    const classified = classifyPositionTacticalMotifs(input);
    expect(classified.motifs.map((m) => m.id)).toEqual(["zugzwang"]);
    expect(classified.motifs[0]).toMatchObject({ ply: 1, relevance: "primary", value: 0 });
    const scan = buildLiveTacticalScan({ ...input, engineName: "Stockfish", depth: 16 });
    expect(scan.labels.map((l) => [l.text, l.square])).toEqual([["Zugzwang", "f6"]]);
    expect(scan.arrows.map((a) => [a.from, a.to])).toEqual([["g4", "f4"]]);
    expect(scan.variations[0].timeline.map((m) => [m.id, m.ply])).toEqual([["zugzwang", 1]]);
    expect(tacticalBoardEvidence(fen, input.pvUci, classified.motifs[0])).toBeNull();
    const reviewInput = { ...input, bestMoveUci: "g4f4", playedMoveUci: "g4f3", refutationUci: [] };
    // The empty cached judgement must neither hide a newly supplied proof nor
    // inherit one from a previous evidence-bearing request.
    expect(
        classifyMistakeReviewMotifs({ ...reviewInput, tablebaseEvidence: undefined }).missedMotifs,
    ).toEqual([]);
    expect(classifyMistakeReviewMotifs(reviewInput).missedMotifs[0]).toMatchObject({
        id: "zugzwang",
        source: "missed",
        ply: 1,
    });
    expect(
        classifyMistakeReviewMotifs({ ...reviewInput, tablebaseEvidence: undefined }).missedMotifs,
    ).toEqual([]);
});

const independent = JSON.parse(
    readFileSync("benchmarks/tactical-relevance/drawing-zugzwang-tablebase-verified.json", "utf8"),
);
test("a larger drawing zugzwang allows losing alternatives and remains a missed defensive lesson", () => {
    const row = tablebaseCases.find((r) => r.id === "EKWHC-reciprocal-draw")!;
    const proof = proveTablebaseZugzwang(row.fen, row.move, row.evidence)!;
    expect(proof).toMatchObject({
        outcome: "draw",
        beneficiary: "black",
        defender: "white",
        passedOutcome: -1,
    });
    expect(new Set(proof.replies.map((reply) => reply.outcome))).toEqual(new Set([0, 1]));
    const input = { fen: row.fen, pvUci: [row.move], tablebaseEvidence: row.evidence };
    const scan = buildLiveTacticalScan({ ...input, engineName: "Stockfish", depth: 16 });
    expect(scan.labels.map((label) => [label.text, label.square])).toEqual([
        ["Drawing Zugzwang", "f4"],
    ]);
    expect(scan.motifs[0].evidence).toContain("best defence only draws");
    expect(scan.motifs[0].evidence).not.toContain("All");
    expect(
        classifyMistakeReviewMotifs({ ...input, bestMoveUci: row.move, playedMoveUci: "e6d6" })
            .missedMotifs[0],
    ).toMatchObject({ id: "zugzwang", label: "Drawing Zugzwang", source: "missed" });
});
test("38 independently sampled KPK responses agree with the strict external verifier", () => {
    expect(independent.tablebase).toHaveLength(38);
    for (const row of independent.tablebase)
        expect({
            id: row.id,
            kind: row.pass,
            result: validateTablebaseRecord({ fen: row.fen, result: row.result }, row.fen)?.outcome,
        }).toEqual({
            id: row.id,
            kind: row.pass,
            result: row.result.category === "win" ? 1 : row.result.category === "loss" ? -1 : 0,
        });
});

test.each(tablebaseCases)("independent endgame judgement: $id", (row) => {
    for (const record of row.evidence.records)
        expect(validateTablebaseRecord(record, record.fen)).not.toBeNull();
    const proof = proveTablebaseZugzwang(row.fen, row.move, row.evidence);
    expect({ judgement: row.judgement, proved: Boolean(proof) }).toEqual({
        judgement: row.judgement,
        proved: row.expectedZugzwang,
    });
    const input = { fen: row.fen, pvUci: [row.move], tablebaseEvidence: row.evidence };
    const result = classifyPositionTacticalMotifs(input);
    expect(result.motifs.some((m) => m.id === "zugzwang")).toBe(row.expectedZugzwang);
    const positive = expect.objectContaining({
        motifs: [expect.objectContaining({ id: "zugzwang", value: 0, ply: 1 })],
    });
    const expected = row.expectedZugzwang
        ? positive
        : classifyPositionTacticalMotifs({ ...input, tablebaseEvidence: undefined });
    expect(result).toEqual(expected);
});

test("a missed defence is blamed only with an independent better-position outcome", () => {
    const root = tablebaseCases.find((r) => r.id === "EKWHC:g4f4")!;
    const better = tablebaseCases.find((r) => r.id === "EKWHC-better-defence")!;
    const input = {
        fen: better.fen,
        bestMoveUci: better.move,
        pvUci: [better.move],
        playedMoveUci: "e5f6",
        refutationUci: [root.move],
        tablebaseEvidence: {
            ...root.evidence,
            records: [...root.evidence.records, better.evidence.records[0]],
        },
    };
    const review = classifyMistakeReviewMotifs(input);
    expect(review.allowedMotifs[0]).toMatchObject({
        id: "zugzwang",
        comparison: "prevented",
        source: "allowed",
    });
    expect(review.allowedMotifs[0].comparisonEvidence).toContain("Ke6 preserves a draw");
    expect(
        classifyMistakeReviewMotifs({ ...input, tablebaseEvidence: root.evidence })
            .allowedMotifs[0],
    ).toMatchObject({ id: "zugzwang" });
    expect(
        classifyMistakeReviewMotifs({ ...input, tablebaseEvidence: root.evidence }).allowedMotifs[0]
            .comparison,
    ).toBeUndefined();
});

test("a promotion response must include every choice, and exact identity includes the halfmove clock", () => {
    const row = tablebaseCases.find((r) => r.id === "promotion-choices")!;
    const record = row.evidence.records[1];
    const moves = (record.result as { moves: { uci: string }[] }).moves;
    expect(
        moves
            .filter((m) => m.uci.startsWith("a7a8"))
            .map((m) => m.uci)
            .sort(),
    ).toEqual(["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
    const broken = structuredClone(record);
    (broken.result as { moves: { uci: string }[] }).moves = moves.filter((m) => m.uci !== "a7a8n");
    expect(validateTablebaseRecord(broken, record.fen)).toBeNull();
    expect(validateTablebaseRecord(record, record.fen.replace("1 1", "2 1"))).toBeNull();
});
