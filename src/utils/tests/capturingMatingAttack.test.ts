import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import {
    proveMatingCaptureCompensation,
    proveMatingCaptureAttack,
    proveQuietMatingAttack,
    replayTacticalLine,
    tacticalBoardEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

// Constructed reduction of a privately reviewed mating net. Qxh3 adds control
// of g2; Rf2 meets g2# but gives up a rook. The original bishop does NOT
// threaten Bxg2#: Kxg2 is legal. Do not invent a defensive-capture lesson.
const fen = "6k1/5ppp/8/8/7q/6pb/4B1PP/5RBK w - - 0 1";
const line = ["g2h3", "h4h3", "f1f2", "g3f2", "g1f2"];

test("a capturing mating threat proves compensation without a supplied recapture PV", () => {
    const root = replayTacticalLine(fen, line)[1];
    const failures: string[] = [];
    const proof = proveMatingCaptureAttack(root, 8192, (reason) => failures.push(reason));
    expect({ failures, proof }).toMatchObject({
        failures: [],
        proof: { gain: 500, threatSan: "g2#" },
    });
    expect(proof?.branches).toContainEqual({ reply: "Rf2", gain: 500, line: ["gxf2"] });
    expect(proveQuietMatingAttack(root)).toBeNull();
});

test.each([[line[0]], line].map((pvUci) => ({ pvUci })))(
    "a compensated capture is neither free material nor a proved defensive move: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(
            result.motifs.some(
                (motif) => ["hangingPiece", "defensiveMove"].includes(motif.id) && motif.ply === 1,
            ),
        ).toBe(false);
        const scan = buildLiveTacticalScan({ fen, pvUci, engineName: "Constructed", depth: 16 });
        expect(scan.motifs).toEqual([]);
        expect(scan.arrows).toEqual([]);
    },
);

test("the recapture is a mating attack at its own ply, with only its actual threat arrows", () => {
    const steps = replayTacticalLine(fen, line);
    const rootFen = makeFen(steps[1].before.toSetup());
    const result = classifyPositionTacticalMotifs({ fen: rootFen, pvUci: [line[1]] });
    expect(result.motifs[0]).toMatchObject({
        id: "forcingAttack",
        label: "Mating Attack",
        value: 500,
    });
    expect(tacticalBoardEvidence(rootFen, [line[1]], result.motifs[0])?.arrows).toEqual([
        { from: "g3", to: "g2" },
    ]);
    expect(result.motifs[0].evidence).toContain("not a forced-mate claim");
    const source = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(source.timeline).toContainEqual(
        expect.objectContaining({ id: "forcingAttack", ply: 2, actor: "black" }),
    );
});

test("mistake review can explain the missed recapture attack without inventing a causal prevention claim", () => {
    const rootFen = makeFen(replayTacticalLine(fen, line)[1].before.toSetup());
    const result = classifyMistakeReviewMotifs({
        fen: rootFen,
        bestMoveUci: line[1],
        playedMoveUci: "h4g5",
        pvUci: line.slice(1),
    });
    expect(result.missedMotifs[0]).toMatchObject({
        id: "forcingAttack",
        label: "Mating Attack",
        ply: 1,
    });
    expect(result.allowedMotifs).toEqual([]);
});

test("a missed compensated capture cannot become a missed-free-piece or defensive-capture lesson", () => {
    const result = classifyMistakeReviewMotifs({
        fen,
        bestMoveUci: line[0],
        playedMoveUci: "e2d3",
        pvUci: line,
    });
    expect(result.missedMotifs).toEqual([]);
});

test("a surviving guard refutes the nominated mating threat", () => {
    const guarded = fen.replace("6pb", "4N1pb");
    const steps = replayTacticalLine(guarded, line);
    expect(proveMatingCaptureAttack(steps[1])).toBeNull();
    expect(proveMatingCaptureCompensation(steps[0])).toBeNull();
});

test("capturing a newly arrived guard restores the exact threat and counts the captured piece", () => {
    const guardCapture = "6k1/5ppp/8/8/2N2p1q/5Ppb/4B1PP/5RBK w - - 0 1";
    const root = replayTacticalLine(guardCapture, line.slice(0, 2))[1];
    const proof = proveMatingCaptureAttack(root);
    expect(proof).toMatchObject({ gain: 320, threatSan: "g2#" });
    expect(proof?.branches).toContainEqual({ reply: "Ne3", gain: 320, line: ["fxe3"] });
    const withoutGuardCapture = guardCapture.replace("2N2p1q", "2N4q");
    expect(
        proveMatingCaptureAttack(replayTacticalLine(withoutGuardCapture, line.slice(0, 2))[1]),
    ).toBeNull();
});

test("a promotion on the material branch needs a legal recapture and the promoted value is debited", () => {
    const guardedPromotion = "r4bk1/2P2ppp/8/8/7q/5Ppb/4B1PP/5RBK w - - 0 1";
    const root = replayTacticalLine(guardedPromotion, line.slice(0, 2))[1];
    const failures: string[] = [];
    const proof = proveMatingCaptureAttack(root, 8192, (reason) => failures.push(reason));
    expect({ proof, failures }).toMatchObject({
        failures: [],
        proof: { gain: 500, threatSan: "g2#" },
    });
    for (const promotion of ["q", "r", "b", "n"]) {
        const after = replayTacticalLine(guardedPromotion, [
            ...line.slice(0, 4),
            `c7c8${promotion}`,
        ]).at(-1)!;
        expect(proof?.decisions).toContainEqual({
            fen: makeFen(after.after.toSetup()),
            move: "a8c8",
        });
    }
});

test("without the mating pawn a genuine material capture is not hidden", () => {
    const free = fen.replace("6pb", "7b");
    const result = classifyPositionTacticalMotifs({ fen: free, pvUci: [line[0]] });
    expect(result.motifs[0]?.id).toBe("hangingPiece");
    expect(proveMatingCaptureCompensation(replayTacticalLine(free, [line[0]])[0])).toBeNull();
});

test("a checking promotion can defeat the mating attack; promotion is not merely another pawn move", () => {
    // a8=Q+ interrupts the threat, unlike a promotion off the king's rank/file.
    const promotion = "2k5/P4ppp/8/8/7q/6pb/4B1PP/5RBK w - - 0 1";
    const steps = replayTacticalLine(promotion, line.slice(0, 2));
    expect(steps).toHaveLength(2);
    const counter = replayTacticalLine(makeFen(steps[1].after.toSetup()), ["a7a8q"])[0];
    expect(counter.after.isCheck()).toBe(true);
    expect(proveMatingCaptureAttack(steps[1])).toBeNull();
    expect(proveMatingCaptureCompensation(steps[0])).toBeNull();
});

test("an unrelated loose piece cannot substitute for capturing the new mating-square guard", () => {
    // Ne3 still guards g2. The b4-pawn could take a rook on c3, but that
    // unrelated capture does not remove the guard or restore g2#.
    const unrelated = "6k1/5ppp/8/8/1p5q/2R1N1pb/4B1PP/5RBK w - - 0 1";
    const steps = replayTacticalLine(unrelated, line.slice(0, 2));
    expect(proveMatingCaptureAttack(steps[1])).toBeNull();
    expect(proveMatingCaptureCompensation(steps[0])).toBeNull();
});

test("colour reflection preserves the compensation and actual mating threat", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "b";
    const moves = line.map((uci) => uci.replace(/[1-8]/g, (rank) => String(9 - Number(rank))));
    const steps = replayTacticalLine(fields.join(" "), moves);
    expect(proveMatingCaptureCompensation(steps[0])).toMatchObject({
        compensation: { gain: 500, threatSan: "g7#" },
    });
    expect(classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: moves }).motifs).toEqual(
        [],
    );
});

test("invalid and exhausted budgets cannot reuse either cached certificate", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveMatingCaptureCompensation(steps[0])).not.toBeNull();
    expect(proveMatingCaptureAttack(steps[1])).not.toBeNull();
    for (const limit of [0, 1, -1, NaN, Infinity, 1.5]) {
        expect(proveMatingCaptureCompensation(steps[0], limit)).toBeNull();
        expect(proveMatingCaptureAttack(steps[1], limit)).toBeNull();
    }
});

test.skipIf(!process.env.TACTICAL_PRIVATE_CAPTURE_DOUBLE_THREAT_REPORT)(
    "independently inspect the additional recovered course root and its alternative defences",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const samplePath = process.env.TACTICAL_PRIVATE_DISJOINT_REPORT!;
        const sample = JSON.parse(readFileSync(samplePath, "utf8"));
        const row = sample.cases.find((r: { id: string }) => r.id === "private-easy:48");
        const root = replayTacticalLine(row.fen, row.sourceUci)[0];
        // The capture removes g6's pawn guard; the knight does not itself
        // defend g6. The premature mating move permits a legal pawn capture.
        expect(replayTacticalLine(row.fen, ["h5g6", "f7g6"])).toHaveLength(2);
        const proof = proveMatingCaptureAttack(root);
        expect(proof).toMatchObject({ gain: 680, threatSan: "Qg6#" });
        expect(proof?.branches).toHaveLength(20);
        expect(proof?.branches).toContainEqual({ reply: "f5", gain: 680, line: ["Nxd8"] });
        expect(
            classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [row.sourceUci[0]] }).motifs[0],
        ).toMatchObject({ id: "forcingAttack", ply: 1, value: 680 });
        const report = { fen: row.fen, move: row.sourceUci[0], proof };
        writeFileSync(
            privateReportPath(process.env.TACTICAL_PRIVATE_CAPTURE_DOUBLE_THREAT_REPORT!),
            JSON.stringify(report, null, 2),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_PRIVATE_CAPTURE_DOUBLE_THREAT_PROBES) {
            const probes = proof!.decisions.map((decision, index) => ({
                id: `recovered-root-decision:${index + 1}`,
                fen: decision.fen,
                searchMove: decision.move,
                ...(replayTacticalLine(decision.fen, [decision.move])[0].after.isCheckmate()
                    ? { mateWithin: 1 }
                    : {}),
            }));
            probes.push(
                { id: "recovered-root", fen: row.fen, searchMove: row.sourceUci[0] },
                {
                    id: "recovered-material-defence",
                    fen: makeFen(root.after.toSetup()),
                    searchMove: "f6f5",
                },
                {
                    id: "checking-promotion-control",
                    fen: "2k5/P4ppp/8/8/7q/6pP/4B2P/5RBK b - - 0 1",
                    searchMove: "h4h3",
                },
                {
                    id: "unrelated-capture-control",
                    fen: "6k1/5ppp/8/8/1p5q/2R1N1pP/4B2P/5RBK b - - 0 1",
                    searchMove: "h4h3",
                },
            );
            writeFileSync(
                privateReportPath(process.env.TACTICAL_PRIVATE_CAPTURE_DOUBLE_THREAT_PROBES),
                JSON.stringify({ samplePath, probes }, null, 2),
                { flag: "wx" },
            );
        }
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_CAPTURE_MATE_REPORT)(
    "inspect the privately sampled compensated capture without publishing paid positions",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_PRIVATE_CAPTURE_MATE_REPORT!);
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_POSITIONAL_UPPER_QUARTER_REPORT!, "utf8"),
        );
        const row = sample.cases.find((row: { id: string }) => row.id === "private-corpus:328");
        const steps = replayTacticalLine(row.fen, row.sourceUci);
        const failures: string[] = [];
        const proof = proveMatingCaptureAttack(steps[1], 8192, (reason) => failures.push(reason));
        const compensation = proveMatingCaptureCompensation(steps[0]);
        const source = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        writeFileSync(
            output,
            JSON.stringify(
                { fen: makeFen(steps[1].before.toSetup()), proof, failures, compensation, source },
                null,
                2,
            ),
            { flag: "wx" },
        );
        expect(proof).toMatchObject({ gain: 320, threatSan: "g2#" });
        expect(proof?.branches).toHaveLength(41);
        expect(compensation).not.toBeNull();
        expect(
            source.motifs.some(
                (m) => m.ply === 1 && ["hangingPiece", "defensiveMove"].includes(m.id),
            ),
        ).toBe(false);
        if (process.env.TACTICAL_PRIVATE_CAPTURE_MATE_PROBES) {
            const probes = proof!.decisions.map((decision, index) => ({
                id: `capture-mate-decision:${index + 1}`,
                fen: decision.fen,
                searchMove: decision.move,
                ...(replayTacticalLine(decision.fen, [decision.move])[0].after.isCheckmate()
                    ? { mateWithin: 1 }
                    : {}),
            }));
            probes.push(
                { id: "private-root", fen: row.fen, searchMove: line[0] },
                {
                    id: "private-recapture",
                    fen: makeFen(steps[1].before.toSetup()),
                    searchMove: line[1],
                },
                {
                    id: "private-ne3-defence",
                    fen: makeFen(steps[1].after.toSetup()),
                    searchMove: "c4e3",
                },
                {
                    id: "private-rf2-defence",
                    fen: makeFen(steps[1].after.toSetup()),
                    searchMove: "f1f2",
                },
                ...[fen, fen.replace("6pb", "4N1pb"), fen.replace("6pb", "7b")].flatMap(
                    (controlFen, index) => [
                        { id: `control:${index}:capture`, fen: controlFen, searchMove: line[0] },
                        {
                            id: `control:${index}:recapture`,
                            fen: makeFen(
                                replayTacticalLine(controlFen, [line[0]])[0].after.toSetup(),
                            ),
                            searchMove: line[1],
                        },
                    ],
                ),
            );
            writeFileSync(
                privateReportPath(process.env.TACTICAL_PRIVATE_CAPTURE_MATE_PROBES),
                JSON.stringify(
                    {
                        samplePath: process.env.TACTICAL_PRIVATE_POSITIONAL_UPPER_QUARTER_REPORT,
                        probes,
                    },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);
