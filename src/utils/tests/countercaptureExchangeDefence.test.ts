import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { expect, test } from "vitest";
import {
    counterCaptureMaterialDefence,
    proveCaptureDeflection,
    replayTacticalLine,
    tacticalBoardEvidence,
    winningRecaptureEvidence,
} from "../tacticalMotifs/causalTactics";
import {
    classifyMistakeReviewMotifs,
    classifyPositionTacticalMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";

// Constructed exchange/queen-guard control, not a paid-course position.
const fen = "2bqr1k1/p5b1/8/3n4/3NP3/8/8/2BQRBK1 w - - 0 1";
const line = ["e4d5", "e8e1", "d1e1", "g7d4"];

test.skipIf(!process.env.TACTICAL_PUBLIC_EXCHANGE_REPORT)(
    "audit the separately reached opening exchange without borrowing the early f7 lesson",
    () => {
        const position = "r4k1r/pbq1b1pp/1pn5/2pBN3/3P4/4P3/PP3PPP/R1BQ1RK1 b - - 0 13";
        const pvUci = ["c6e5", "d5b7", "c7b7", "d4e5"];
        const steps = replayTacticalLine(position, pvUci);
        expect(steps).toHaveLength(4);
        const audits: unknown[] = [];
        const proof = counterCaptureMaterialDefence(steps[0], 8192, 0, true, (audit) =>
            audits.push(audit),
        );
        const result = classifyPositionTacticalMotifs({ fen: position, pvUci });
        writeFileSync(
            process.env.TACTICAL_PUBLIC_EXCHANGE_REPORT!,
            JSON.stringify({ fen: position, pvUci, proof, audits, result }, null, 2),
            { flag: "wx" },
        );
    },
);

test("an off-square checking capture can compensate the knight after a rook exchange", () => {
    const steps = replayTacticalLine(fen, line);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.balance)).toEqual([320, -180, 320, 0]);
    expect(counterCaptureMaterialDefence(steps[0], 8192, 0, true)?.defence).toBe("Rxe1");
    const result = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
    expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
});

test("the move-order mechanism and material recovery stay at their actual plies", () => {
    const position = fen.replace("2bqr1k1/p5b1", "2b1r1k1/p1q3b1");
    const steps = replayTacticalLine(position, line);
    const deflection = proveCaptureDeflection(steps[1]);
    expect(deflection).toMatchObject({
        gain: 320,
        accepted: [{ mode: "guard", reply: "Qxe1", answer: "Bxd4+" }],
    });
    const result = classifyPositionTacticalMotifs({ fen: position, pvUci: line });
    expect(result.motifs).toEqual([]);
    expect(result.timeline?.map((m) => [m.id, m.label, m.ply, m.actor])).toEqual([
        ["deflection", "Deflection", 2, "black"],
        ["hangingPiece", "Material Recovery", 4, "black"],
    ]);
    expect(result.timeline?.[1]).toMatchObject({ value: 0 });
    expect(result.timeline?.[1].evidence).toContain("no net material gain");
    const reached = classifyPositionTacticalMotifs({
        fen: makeFen(steps[1].before.toSetup()),
        pvUci: line.slice(1),
    });
    expect(reached.motifs[0]).toMatchObject({ id: "deflection", ply: 1 });
    expect(reached.timeline?.find((m) => m.ply === 3)).toMatchObject({
        label: "Deflection Payoff",
        value: 320,
    });
    expect(
        tacticalBoardEvidence(makeFen(steps[1].before.toSetup()), line.slice(1), reached.motifs[0]),
    ).toEqual({
        square: "e1",
        arrows: [
            { from: "d1", to: "e1" },
            { from: "d1", to: "d4" },
        ],
    });
    const forged = [...steps];
    forged[0] = { ...forged[0], capture: 900 };
    expect(
        winningRecaptureEvidence(forged, 3, {
            ...reached.timeline!.find((m) => m.ply === 3)!,
            label: "Hanging Piece",
        })?.label,
    ).not.toBe("Material Recovery");
});

test("a separately proved intermediate capture remains more informative than generic recovery", () => {
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.timeline?.map((m) => [m.id, m.ply])).toEqual([
        ["deflection", 2],
        ["intermezzo", 4],
    ]);
});

test.each([
    ["2bqr1k1/p7/8/3n4/3NP3/8/8/2BQRBK1 w - - 0 1", "the compensating bishop is absent"],
    ["2bqr1k1/p5b1/5p2/3n4/3NP3/8/8/2BQRBK1 w - - 0 1", "the bishop's capture is blocked"],
    [
        "2bqr1k1/p5b1/8/3n4/3NP3/2B5/8/2BQRBK1 w - - 0 1",
        "another guard can recapture the checking bishop",
    ],
    [
        "2bqr1k1/p5b1/8/3n4/3NP3/8/8/2BQRRK1 w - - 0 1",
        "the f1 rook can recapture without moving the queen guard",
    ],
] as const)("a genuine capture survives when %s (%s)", (position, _reason) => {
    const steps = replayTacticalLine(position, [line[0]]);
    expect(steps).toHaveLength(1);
    expect(counterCaptureMaterialDefence(steps[0], 8192, 0, true)).toBeNull();
    expect(proveCaptureDeflection(replayTacticalLine(position, line.slice(0, 2))[1])).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: [line[0]] }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(true);
});

test("the alternative rook recapture really preserves the queen's guard", () => {
    const position = "2bqr1k1/p5b1/8/3n4/3NP3/8/8/2BQRRK1 w - - 0 1";
    const steps = replayTacticalLine(position, ["e4d5", "e8e1", "f1e1", "g7d4", "d1d4"]);
    expect(steps).toHaveLength(5);
    expect(steps.at(-1)!.balance).toBe(330);
});

test.each([0, 1, -1, 1.5, NaN, Infinity])(
    "partial budgets supply no compensation witness: %s",
    (limit) => {
        const receipt: unknown[] = [];
        expect(
            counterCaptureMaterialDefence(
                replayTacticalLine(fen, line)[0],
                limit,
                0,
                true,
                (audit) => receipt.push(audit),
            ),
        ).toBeNull();
        expect(proveCaptureDeflection(replayTacticalLine(fen, line)[1], limit)).toBeNull();
        expect(receipt).toEqual([]);
    },
);

test("reflected colours preserve the same material accounting and defence", () => {
    const parts = fen.split(" ");
    parts[0] = parts[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-z]/gi, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    parts[1] = "b";
    const pvUci = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    const steps = replayTacticalLine(parts.join(" "), pvUci);
    expect(steps).toHaveLength(4);
    expect(counterCaptureMaterialDefence(steps[0], 8192, 0, true)?.defenceUci).toBe("e1e8");
    expect(
        classifyPositionTacticalMotifs({ fen: parts.join(" "), pvUci }).motifs.some(
            (m) => m.id === "hangingPiece",
        ),
    ).toBe(false);
});

test.skipIf(!process.env.TACTICAL_PRIVATE_POSITIONAL_QUARTER_REPORT)(
    "the real positional-course temptation has the same compensating defence",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_POSITIONAL_QUARTER_REPORT!, "utf8"),
        );
        const row = report.cases.find((r: { id: string }) => r.id === "private-corpus:501");
        expect(row).toBeDefined();
        const preparation = replayTacticalLine(row.fen, row.sourceUci);
        expect(preparation).toHaveLength(3);
        const position = makeFen(preparation.at(-1)!.after.toSetup());
        const steps = replayTacticalLine(position, line);
        expect(steps).toHaveLength(4);
        const audits: unknown[] = [];
        const proof = counterCaptureMaterialDefence(steps[0], 8192, 0, true, (audit) =>
            audits.push(audit),
        );
        expect(proof?.defence).toBe("Rxe1");
        const result = classifyPositionTacticalMotifs({ fen: position, pvUci: line });
        const failures: string[] = [];
        const deflection = proveCaptureDeflection(steps[1], 16384, (reason) =>
            failures.push(reason),
        );
        expect({ deflection, failures }).toMatchObject({ deflection: { gain: 320 }, failures: [] });
        const reached = classifyPositionTacticalMotifs({
            fen: makeFen(steps[1].before.toSetup()),
            pvUci: [line[1]],
        });
        expect(reached.motifs[0]).toMatchObject({ id: "deflection", ply: 1 });
        // Fresh engine review prefers Rxe1 (-11 cp Black) to the premature
        // Bxd4+ (-203): Qxd4 Rxe1 Bf4 gains a tempo against Qc7 and clears
        // the other rook's route. Keep the missed move-order lesson without
        // asserting an independently unproved opponent causal comparison.
        const wrongOrder = ["g7d4", "d1d4", "e8e1", "c1f4"];
        expect(replayTacticalLine(makeFen(steps[1].before.toSetup()), wrongOrder)).toHaveLength(4);
        const review = classifyMistakeReviewMotifs({
            fen: makeFen(steps[1].before.toSetup()),
            bestMoveUci: line[1],
            playedMoveUci: wrongOrder[0],
            pvUci: line.slice(1),
            refutationUci: wrongOrder.slice(1),
        });
        expect(review.missedMotifs[0]).toMatchObject({ id: "deflection", source: "missed", ply: 1 });
        expect(
            tacticalBoardEvidence(makeFen(steps[1].before.toSetup()), [line[1]], reached.motifs[0]),
        ).toEqual({
            square: "e1",
            arrows: [
                { from: "d1", to: "e1" },
                { from: "d1", to: "d4" },
            ],
        });
        if (process.env.TACTICAL_EXCHANGE_DEFENCE_REPORT)
            writeFileSync(
                process.env.TACTICAL_EXCHANGE_DEFENCE_REPORT,
                JSON.stringify(
                    { fen: position, line, proof, audits, deflection, reached, result },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        expect(result.motifs.some((m) => m.id === "hangingPiece")).toBe(false);
    },
);

test.skipIf(
    !process.env.TACTICAL_EXCHANGE_SECONDARY_INPUT ||
        !process.env.TACTICAL_EXCHANGE_SECONDARY_REPORT,
)(
    "audit a later pawn-guard deflection without promoting it to the missing first-move lesson",
    () => {
        const input = JSON.parse(
            readFileSync(process.env.TACTICAL_EXCHANGE_SECONDARY_INPUT!, "utf8"),
        );
        const row = input.cases.find((entry: { id: string }) => entry.id === "private-easy:114");
        expect(row).toBeDefined();
        const line = row.engineLines[1].pvUci;
        const steps = replayTacticalLine(row.fen, line);
        expect(steps).toHaveLength(line.length);
        const root = steps[5];
        const proof = proveCaptureDeflection(root);
        expect(proof?.accepted).toContainEqual(
            expect.objectContaining({ mode: "guard", gain: 100 }),
        );
        const result = classifyPositionTacticalMotifs({
            fen: row.fen,
            pvUci: line,
            rootCp: row.engineLines[1].cp,
        });
        expect(result.motifs).toEqual([]);
        expect(result.timeline).toContainEqual(
            expect.objectContaining({ id: "deflection", ply: 6, actor: "black" }),
        );
        writeFileSync(
            process.env.TACTICAL_EXCHANGE_SECONDARY_REPORT!,
            JSON.stringify(
                { fen: makeFen(root.before.toSetup()), moveUci: root.uci, proof, result },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
