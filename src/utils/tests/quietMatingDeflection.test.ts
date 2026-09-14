import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    proveMatingDeflection,
    proveCaptureForkPreparation,
    replayTacticalLine,
    tacticalBoardEvidence,
    proveMatingCaptureReply,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

const fen = "4r2k/5rp1/6qp/3PB3/4Q2n/3R4/6PP/4R1K1 b - - 0 1";
const line = ["e8e5", "e4h4", "e5e1", "h4e1", "g6d3"];

test("a declining knight's back-rank threat must be answered, not ignored for a queen", () => {
    const position = fen.replace("6qp", "2b3qp").replace("3PB3", "3NB3");
    const bad = replayTacticalLine(position, ["e8e5", "d5f6", "e5e4"]);
    expect(bad).toHaveLength(3);
    expect(proveMatingCaptureReply(bad[2],4096,undefined,4)).not.toBeNull();
    const proof = proveMatingDeflection(bad[0]);
    expect(proof?.declined).toContainEqual({reply:"Nf6",answer:"Qxf6",gain:150});
    expect(proof?.gain).toBe(150);
});

test("a quiet mating offer uses the sound direct capture, not a losing checking exchange", () => {
    const root = replayTacticalLine(fen, line)[0],
        failures: string[] = [];
    const proof = proveMatingDeflection(root, 8192, (r) => failures.push(r));
    expect({ proof, failures }).toMatchObject({ proof: { gain: 330 }, failures: [] });
    expect(proof!.mating).toContainEqual(
        expect.objectContaining({ reply: "Qxe5", mate: "Qxg2#", mode: "guard" }),
    );
    expect(proof!.declined).toContainEqual({
        reply: "Qxh4",
        answer: "Qxd3",
        gain: 510,
        directPayoff: true,
    });
    expect(proof!.declined).toContainEqual({ reply: "Qxg6", answer: "Rxe1#", gain: 10000 });
});

test("the displayed mate is conditional and the declined exchange is not falsely called a fork", () => {
    for (const pvUci of [line, line.slice(0, 1), ["e8e5", "e4e5", "g6g2"]]) {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1, value: 330 });
        expect(result.motifs[0].evidence).toContain("Accepting with Qxe5 allows Qxg2#");
        expect(result.motifs[0].evidence).toContain("Qxh4 Qxd3");
        expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
        expect(tacticalBoardEvidence(fen, pvUci, result.motifs[0])?.arrows).toEqual([
            { from: "e4", to: "e5" },
        ]);
    }
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(
        result.timeline?.some(
            (m) =>
                m.id === "fork" ||
                m.id === "forkPreparation" ||
                m.id === "intermezzo" ||
                m.label === "Winning Recapture",
        ),
    ).toBe(false);
    expect(result.timeline?.some((m) => m.ply === 2 && m.id === "hangingPiece")).toBe(false);
    // The cooperative checking-exchange line permits Qe8+ and Qxf7.
    // Its final rook capture is not a separately profitable payoff.
    expect(result.timeline?.some(m => m.ply === 5 && m.id === "hangingPiece")).toBe(false);
    expect(classifyPositionTacticalMotifs({ fen, pvUci: ["e8e5", "e4h4", "g6d3"] }).timeline)
        .toContainEqual(expect.objectContaining({ ply: 3, label: "Deflection Payoff", value: undefined }));
});

test("off-square liabilities reject the knight capture even without usable root history", () => {
    const reached = makeFen(replayTacticalLine(fen, line)[0].after.toSetup());
    const input = { fen: reached, pvUci: [line[1]], engineName: "Constructed", depth: 16 };
    expect(buildLiveTacticalScan(input).motifs.some(m => m.id === "hangingPiece")).toBe(false);
    expect(
        buildLiveTacticalScan({ ...input, previousFen: fen, previousMoveUci: line[0] }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(false);
    expect(
        buildLiveTacticalScan({ ...input, previousFen: fen, previousMoveUci: "e8d8" }).motifs.some(m => m.id === "hangingPiece"),
    ).toBe(false);
});

test("a countercheck forbids the apparent checking exchange", () => {
    const position = fen.replace("6qp", "6q1");
    const replay = replayTacticalLine(position, line);
    expect(replay).toHaveLength(2);
    expect(replay[1].san).toBe("Qxh4+");
    expect(proveMatingDeflection(replay[0])).toBeNull();
});

test("a pin can prevent the offered rook from making its checking exchange", () => {
    const position = fen.replace("5rp1", "5r2");
    const replay = replayTacticalLine(position, [line[0], "e4d4", "e5e1"]);
    expect(replay).toHaveLength(2);
    expect(proveMatingDeflection(replay[0])).toBeNull();
});

test("a smaller target is profitable through the direct capture, without the checking-exchange loss", () => {
    const position = fen.replace("3R4", "3B4");
    expect(replayTacticalLine(position, line)).toHaveLength(5);
    expect(proveMatingDeflection(replayTacticalLine(position, line)[0])?.declined).toContainEqual({
        reply: "Qxh4", answer: "Qxd3", gain: 340, directPayoff: true,
    });
});

test("removing the knight removes the accepted mating threat", () => {
    const position = fen.replace("4Q2n", "4Q3");
    const replay = replayTacticalLine(position, [line[0], "e4e5", "g6g2", "g1g2"]);
    expect(replay).toHaveLength(4);
    expect(proveMatingDeflection(replay[0])).toBeNull();
});

test("the supporting rook is not necessary if the queen can be recovered after a king flight", () => {
    const position = fen.replace("5rp1", "6p1");
    const replay = replayTacticalLine(position, [line[0], "e4g6", "e5e1", "g1f2", "h4g6"]);
    expect(replay).toHaveLength(5);
    const failures: string[] = [];
    expect({
        proof: proveMatingDeflection(replay[0], 8192, (r) => failures.push(r)),
        failures,
    }).toMatchObject({ proof: { gain: 330 }, failures: [] });
});

test("reflection keeps the same bounded material proof and root lesson", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const reflected = fields.join(" ");
    const failures: string[] = [];
    expect({
        proof: proveMatingDeflection(replayTacticalLine(reflected, pvUci)[0], 8192, (r) =>
            failures.push(r),
        ),
        failures,
    }).toMatchObject({ proof: { gain: 330 }, failures: [] });
    expect(classifyPositionTacticalMotifs({ fen: reflected, pvUci }).motifs[0]?.id).toBe(
        "deflection",
    );
});

test("invalid or exhausted searches cannot reuse a quiet-offer success", () => {
    const root = replayTacticalLine(fen, line)[0];
    expect(proveMatingDeflection(root)).not.toBeNull();
    for (const limit of [0, -1, 1, 20, NaN, Infinity, 1.5])
        expect(proveMatingDeflection(root, limit)).toBeNull();
    expect(proveMatingDeflection(root)).not.toBeNull();
});

test.skipIf(!process.env.TACTICAL_PRIVATE_PGN_SAMPLE)(
    "the private rook offer has a mating acceptance and material decline, not a sound knight fork",
    () => {
        const row = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_PGN_SAMPLE!, "utf8"),
        ).cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 202);
        const root = replayTacticalLine(row.fen, row.sourceUci)[0],
            failures: string[] = [];
        const proof = proveMatingDeflection(root, 8192, (r) => failures.push(r));
        expect({ proof, failures }).toMatchObject({ proof: { gain: 150 }, failures: [] });
        expect(proveCaptureForkPreparation(root)).toBeNull();
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]).toMatchObject({ id: "deflection", ply: 1 });
    },
);
