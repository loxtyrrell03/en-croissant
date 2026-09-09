import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { replayTacticalLine, proveCheckingMaterialAttack } from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";

const fen = "4r1rk/4q2p/8/8/8/3BN3/1PP5/R1K5 b - - 0 1";
const line = ["g8g1", "c1d2", "g1a1"];

test("a king skewer survives a defended block through a checking continuation", () => {
    expect(replayTacticalLine(fen, line)).toHaveLength(3);
    const result = classifyPositionTacticalMotifs({ fen, pvUci: line });
    expect(result.motifs[0]).toMatchObject({ id: "skewer", ply: 1, value: 500 });
    expect(result.motifs[0].evidence).toContain("Bf1 Rxf1+ Kd2 Rxa1");
});

test("the knight recapture and a second block allow actual mate", () => {
    const accepted = ["g8g1", "d3f1", "g1f1", "e3f1", "e7e1"];
    const blocked = ["g8g1", "e3d1", "g1d1", "c1d1", "e7e1"];
    for (const moves of [accepted, blocked]) {
        const steps = replayTacticalLine(fen, moves);
        expect(steps).toHaveLength(moves.length);
        expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
    }
});

test("without the supporting pieces, blocking really refutes the skewer", () => {
    const position = "6rk/7p/8/8/8/3BN3/1PP5/R1K5 b - - 0 1";
    expect(proveCheckingMaterialAttack(replayTacticalLine(position, [line[0]]))).toBeNull();
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: line }).motifs.some(
            (m) => m.id === "skewer",
        ),
    ).toBe(false);
});

test.each([[line[0]], line, ["g8g1", "d3f1", "g1f1", "e3f1", "e7e1"]].map((pvUci) => ({ pvUci })))(
    "the starting skewer is proved independently of the chosen response: $pvUci",
    ({ pvUci }) => {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "skewer", ply: 1, value: 500 });
    },
);

test("every legal response has a replayable continuation", () => {
    const root = replayTacticalLine(fen, line)[0];
    const proof = proveCheckingMaterialAttack([root])!;
    const replies = [...root.after.allDests()].flatMap(([from, dests]) =>
        [...dests].map((to) => makeSan(root.after, { from, to })),
    );
    expect(proof.branches.map((b) => b.reply).sort()).toEqual(replies.sort());
    for (const branch of proof.branches) {
        const pos = root.after.clone();
        for (const san of [branch.reply, ...branch.line]) {
            const move = parseSan(pos, san)!;
            expect(move).toBeDefined();
            expect(pos.isLegal(move)).toBe(true);
            pos.play(move);
        }
    }
});

test("invalid or exhausted checking budgets cannot borrow the default proof", () => {
    const steps = replayTacticalLine(fen, line);
    expect(proveCheckingMaterialAttack(steps)).not.toBeNull();
    for (const budget of [0, -1, 1, NaN, Infinity, 1.5])
        expect(proveCheckingMaterialAttack(steps, budget)).toBeNull();
});

test("without a rear target the check cannot invent a skewer", () => {
    const position = fen.replace("R1K5", "2K5");
    expect(replayTacticalLine(position, [line[0]])).toHaveLength(1);
    expect(
        classifyPositionTacticalMotifs({ fen: position, pvUci: [line[0]] }).motifs.some(
            (m) => m.id === "skewer",
        ),
    ).toBe(false);
});

test("reflection preserves the king skewer and its actual gain", () => {
    const fields = fen.split(" ");
    fields[0] = fields[0]
        .split("/")
        .reverse()
        .join("/")
        .replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    fields[1] = "w";
    const reflected = line.map((m) => m.replace(/[1-8]/g, (r) => String(9 - Number(r))));
    expect(
        classifyPositionTacticalMotifs({ fen: fields.join(" "), pvUci: reflected }).motifs[0],
    ).toMatchObject({ id: "skewer", ply: 1, value: 500 });
});

test("board preview names the skewer on the actual checking move", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: line, engineName: "Constructed", depth: 16 });
    expect(scan.labels[0].text).toContain("Skewer");
    expect(scan.arrows.map((a) => a.from + a.to)).toContain("g8g1");
});

test.each([fen, fen.replace("3BN3", "3B4")])(
    "the same blocked skewer after both choices is existing danger, not newly caused: %s",
    (position) => {
        const before = position.replace("1PP5", "PPP5").replace(" b ", " w ");
        const review = classifyMistakeReviewMotifs({
            fen: before,
            bestMoveUci: "a2a4",
            playedMoveUci: "a2a3",
            pvUci: ["a2a4"],
            refutationUci: line,
        });
        expect(review.allowedMotifs[0]).toMatchObject({ id: "skewer", comparison: "persists" });
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE)(
    "an incidental king skewer does not replace a separately nominated checking attack",
    () => {
        const sample = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_DISJOINT_SAMPLE!, "utf8"),
        );
        const row = sample.cases.find((r: { eligibleIndex: number }) => r.eligibleIndex === 2);
        const result = classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.sourceUci });
        expect(result.motifs[0]).toMatchObject({ id: "forcingAttack", ply: 1, value: 730 });
    },
);

test.skipIf(!process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT)(
    "the real checking-rook reply has a skewer explanation",
    () => {
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_PRIVATE_MATING_OVERLAP_REPORT!, "utf8"),
        );
        const row = report.searches.find((s: { id: string }) => s.id === "real-missed-alternative");
        const steps = replayTacticalLine(row.fen, row.lines[0].pvUci);
        const fen = makeFen(steps[0].after.toSetup());
        const result = classifyPositionTacticalMotifs({ fen, pvUci: row.lines[0].pvUci.slice(1) });
        expect(proveCheckingMaterialAttack([steps[1]])).toMatchObject({ gain: 500 });
        expect(result.motifs[0]).toMatchObject({ id: "skewer", ply: 1 });
        const review = classifyMistakeReviewMotifs({
            fen: row.fen,
            bestMoveUci: "h6f6",
            playedMoveUci: "d2c1",
            pvUci: ["h6f6"],
            refutationUci: row.lines[0].pvUci.slice(1),
        });
        expect(review.allowedMotifs[0]).toMatchObject({ id: "skewer", comparison: "prevented" });
        expect(buildMistakeReviewTacticalExplanation(review)).toMatchObject({
            source: "allowed",
            primary: { id: "skewer" },
            secondary: { id: "deflection" },
        });
    },
);
