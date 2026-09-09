import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { proveMatingDeflection, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { makeFen } from "chessops/fen";
import { parseSquare } from "chessops/util";

const constructed = "8/3Q4/6pp/5n1k/2B1N1pq/8/3B4/6K1 w - - 0 1";

test("deflecting a knight removes its legal capture of the mating rook", () => {
    const fen = "4N2k/7p/4Bn2/5B2/8/7Q/8/K5R1 w - - 0 1";
    expect(replayTacticalLine(fen, ["h3h7", "f6h7", "g1g8"])[2].after.isCheckmate()).toBe(true);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["h3h7"])[0])).toMatchObject({
        mating: [{ reply: "Nxh7", mate: "Rg8#", mode: "guard" }],
        declined: [],
    });
});

test("a second receiver that can capture the mating rook refutes the sacrifice", () => {
    const fen = "4N1bk/7p/4Bn2/5B2/8/7Q/8/K5R1 w - - 0 1";
    expect(replayTacticalLine(fen, ["h3h7", "g8h7", "g1g8", "h7g8"])).toHaveLength(4);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["h3h7"])[0])).toBeNull();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "private mating deflections include material-preserving declines",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        for (const index of [10]) {
            const row = sample.cases.find(
                (r: { eligibleIndex: number }) => r.eligibleIndex === index,
            );
            const failures: string[] = [];
            const proof = proveMatingDeflection(
                replayTacticalLine(row.fen, row.sourceUci)[0],
                8192,
                (reason) => failures.push(reason),
            );
            expect(failures).toEqual([]);
            expect(proof).not.toBeNull();
            expect(proof?.gain).toBe(320);
            for (const pvUci of [
                [row.sourceUci[0]],
                row.sourceUci,
                ["e7f6", "h5g6", "d3g6", "g7f6", "g6f7"],
            ]) {
                expect(
                    classifyPositionTacticalMotifs({ fen: row.fen, pvUci }).motifs[0],
                ).toMatchObject({ id: "deflection", ply: 1, value: 320 });
            }
        }
    },
);

test("constructed blocked mating ray", () => {
    const fen = constructed;
    const failures: string[] = [];
    const proof = proveMatingDeflection(replayTacticalLine(fen, ["d7f5"])[0], 8192, (r) =>
        failures.push(r),
    );
    expect(failures).toEqual([]);
    expect(proof).toMatchObject({ gain: 320 });
    expect(proof?.mating).toEqual([
        expect.objectContaining({ reply: "gxf5", mate: "Bf7#", mode: "block" }),
    ]);
    expect(proof?.declined).toEqual([
        expect.objectContaining({ reply: "Qg5", answer: "Bxg5", gain: 320 }),
        expect.objectContaining({ reply: "g5", gain: 320 }),
    ]);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["d7f5"] }).motifs[0]).toMatchObject({
        id: "deflection",
        ply: 1,
    });
});

test("a king flight refutes the apparent mating acceptance", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    root.before.board.take(parseSquare("e4")!);
    root.before.board.take(parseSquare("d2")!);
    const fen = makeFen(root.before.toSetup());
    expect(replayTacticalLine(fen, ["d7f5", "g6f5", "c4f7", "h5g5"])).toHaveLength(4);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["d7f5"])[0])).toBeNull();
});

test("a missing mating bishop cannot be inferred from the offer", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    root.before.board.take(parseSquare("c4")!);
    expect(
        proveMatingDeflection(replayTacticalLine(makeFen(root.before.toSetup()), ["d7f5"])[0]),
    ).toBeNull();
});

test("an added rook can capture the mating bishop", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    root.before.board.set(parseSquare("f8")!, { color: "black", role: "rook" });
    const fen = makeFen(root.before.toSetup());
    expect(replayTacticalLine(fen, ["d7f5", "g6f5", "c4f7", "f8f7"])).toHaveLength(4);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["d7f5"])[0])).toBeNull();
});

test("a pinned bishop cannot deliver the geometric mate", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    root.before.board.take(parseSquare("g1")!);
    root.before.board.set(parseSquare("c1")!, { color: "white", role: "king" });
    root.before.board.set(parseSquare("c8")!, { color: "black", role: "rook" });
    const fen = makeFen(root.before.toSetup());
    expect(replayTacticalLine(fen, ["d7f5", "g6f5", "c4f7"])).toHaveLength(2);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["d7f5"])[0])).toBeNull();
});

test("a new h6 king flight refutes the mating proof", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    root.before.board.take(parseSquare("h6")!);
    root.before.board.take(parseSquare("d2")!);
    const fen = makeFen(root.before.toSetup());
    expect(replayTacticalLine(fen, ["d7f5", "g6f5", "c4f7", "h5h6"])).toHaveLength(4);
    expect(proveMatingDeflection(replayTacticalLine(fen, ["d7f5"])[0])).toBeNull();
});

test("invalid and exhausted budgets abstain even after cached success", () => {
    const root = replayTacticalLine(constructed, ["d7f5"])[0];
    expect(proveMatingDeflection(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity])
        expect(proveMatingDeflection(root, limit)).toBeNull();
    expect(proveMatingDeflection(root)).not.toBeNull();
});

test("root and accepted/declined continuations keep the conditional root lesson", () => {
    for (const pvUci of [
        ["d7f5"],
        ["d7f5", "g6f5", "c4f7"],
        ["d7f5", "h4g5", "d2g5"],
        ["d7f5", "g6g5", "e4g5"],
    ]) {
        const result = classifyPositionTacticalMotifs({ fen: constructed, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1, value: 320 });
        expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
    }
});

test("board highlights the offer without drawing the conditional mate as current", () => {
    const scan = buildLiveTacticalScan({
        fen: constructed,
        pvUci: ["d7f5"],
        depth: 16,
        engineName: "Constructed",
    });
    expect(scan.arrows.map((a) => a.from + a.to)).toEqual(expect.arrayContaining(["d7f5", "g6f5"]));
    expect(scan.arrows.map((a) => a.from + a.to)).not.toContain("c4f7");
});

test("missed opportunities retain the deflection mechanism", () => {
    const review = classifyMistakeReviewMotifs({
        fen: constructed,
        bestMoveUci: "d7f5",
        playedMoveUci: "g1f1",
        pvUci: ["d7f5"],
        refutationUci: [],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "deflection", value: 320 });
});

test("colour reflection preserves the proof and primary", () => {
    const fields = constructed.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: ["d2f4"] }).motifs[0],
    ).toMatchObject({ id: "deflection", value: 320 });
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "quiet mating offers remain outside the checking proof",
    () => {
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"));
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 183);
        expect(proveMatingDeflection(replayTacticalLine(row.fen, row.sourceUci)[0])).toBeNull();
    },
);
