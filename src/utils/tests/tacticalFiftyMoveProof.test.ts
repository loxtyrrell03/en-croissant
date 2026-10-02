import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
    proveCheckingMaterialAttack,
    proveExchangeDeflection,
    proveForcedSelfInterference,
    proveMatingKingDeflection,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Small public/constructed boundary contrasts, not a population accuracy test.
// FIDE 9.3.1 permits a claim by the intended non-zeroing 100th halfmove;
// a subsequent capture does not undo that earlier defensive resource.
const cases = [
    {
        id: "checking-material",
        fen: "r3k3/ppq2p1p/4p3/3pN2r/5P2/1P3BK1/PQ5P/R2R1b2 b q - 0 23",
        line: ["h5h3", "g3f2", "h3h2", "f2f1", "h2b2"],
        primary: "forcingAttack",
        proof: (steps: ReturnType<typeof replayTacticalLine>) => proveCheckingMaterialAttack(steps),
    },
    {
        id: "forced-self-interference",
        fen: "8/3r4/5Q2/p6P/2k5/2P5/P3pBPK/3q4 w - - 0 66",
        line: ["f6c6", "c4d3", "c6d7"],
        primary: "interference",
        proof: (steps: ReturnType<typeof replayTacticalLine>) => proveForcedSelfInterference(steps[0]),
    },
    {
        id: "exchange-deflection",
        fen: "4r1k1/3q1pbp/6p1/3Q4/8/5P2/P5PP/R2R2K1 b - - 0 1",
        line: ["e8e1", "g1f2", "d7d5", "d1d5", "e1a1"],
        primary: "deflection",
        proof: (steps: ReturnType<typeof replayTacticalLine>) => proveExchangeDeflection(steps[0]),
    },
    {
        id: "mating-king-deflection",
        fen: "r2q1r2/p4p1k/1p2pP1n/2p4R/3p1P2/P2P1N1P/1PP4K/6R1 w - - 0 30",
        line: ["g1g7", "h7h8", "h5h6"],
        primary: "mateIn2",
        proof: (steps: ReturnType<typeof replayTacticalLine>) => proveMatingKingDeflection(steps[0]),
    },
];
const report: { id: string; fen: string; pvUci: string[]; expected: unknown; actual: unknown; pass: boolean }[] = [];
afterAll(() => {
    if (!process.env.TACTICAL_FIFTY_MOVE_REPORT) return;
    const source = readFileSync("src/utils/tacticalMotifs/causalTactics.ts", "utf8").replace(/\r\n/g, "\n");
    writeFileSync(process.env.TACTICAL_FIFTY_MOVE_REPORT, JSON.stringify({
        classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        sourceSha256LF: createHash("sha256").update(source).digest("hex"),
        scope: "Public/synthetic legal draw-boundary contracts; no owner corpus, engine, or runtime activity.",
        contracts: report.length, passed: report.filter(row => row.pass).length, cases: report,
    }, null, 2), { flag: "wx" });
});
function atClock(fen: string, clock: number) {
    const fields = fen.split(" "); fields[4] = String(clock); return fields.join(" ");
}
function input(fen: string, line: string[], flip: boolean) {
    return { fen: flip ? reflectMixedForkFen(fen) : fen, pvUci: flip ? line.map(reflectMixedForkMove) : line };
}
function record(id: string, row: { fen: string; pvUci: string[] }, expected: unknown, actual: unknown) {
    report.push({ id, ...row, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) });
    expect(actual).toEqual(expected);
}
for (const row of cases) for (const clock of [0, 97, 98, 99, 100]) test.each([false, true])(
    `${row.id}, clock=${clock}, reflected=%s`, flip => {
        const supplied = input(atClock(row.fen, clock), row.line, flip);
        const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
        expect(steps).toHaveLength(row.line.length);
        const result = classifyPositionTacticalMotifs(supplied);
        const liveRoot = result.motifs.filter(m => m.ply === 1);
        const mechanism = row.id === "mating-king-deflection" ? "deflection" : row.primary;
        const supported = clock < 98;
        record(`${row.id}:${clock}:${flip}`, supplied,
            { proved: supported, primary: supported ? row.primary : null, timelineMechanism: supported },
            { proved: Boolean(row.proof(steps)), primary: liveRoot[0]?.id ?? null,
                timelineMechanism: Boolean(result.timeline?.some(m => m.ply === 1 && m.id === mechanism)) });
    },
);

// With h2 empty, Rh2+ does not reset the count. The defender's later claim
// invalidates the root proof even though no claim existed after Rh3+.
for (const clock of [95, 96, 97]) test.each([false, true])(
    `checking continuation must cover later claims, clock=${clock}, reflected=%s`, flip => {
        const base = cases[0], supplied = input(atClock(base.fen.replace("PQ5P", "PQ6"), clock), base.line, flip);
        const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
        expect(steps).toHaveLength(base.line.length);
        expect(steps[2].capture).toBe(0);
        const result = classifyPositionTacticalMotifs(supplied);
        const supported = clock === 95;
        record(`later-claim:${clock}:${flip}`, supplied,
            { proved: supported, primary: supported ? "forcingAttack" : null },
            { proved: Boolean(proveCheckingMaterialAttack(steps)), primary: result.motifs.find(m => m.ply === 1)?.id ?? null });
    },
);

test.each([false, true])("a root capture resets the clock before forced interference, reflected=%s", flip => {
    const base = cases[1], supplied = input(atClock(base.fen.replace("5Q2", "2p2Q2"), 100), base.line, flip);
    const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
    expect(steps).toHaveLength(base.line.length);
    expect(steps[0].capture).toBe(100);
    expect(steps[0].after.halfmoves).toBe(0);
    record(`capturing-reset:${flip}`, supplied, { proved: true }, { proved: Boolean(proveForcedSelfInterference(steps[0])) });
});

test.each([false, true])("a pawn clearance resets the clock before its interference, reflected=%s", flip => {
    const supplied = input("3k4/1r5q/3PP3/8/8/8/8/K6Q w - - 100 1", ["e6e7", "d8c8", "h1h7"], flip);
    const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
    expect(steps).toHaveLength(3);
    expect(steps[0].after.halfmoves).toBe(0);
    record(`pawn-reset:${flip}`, supplied, { primary: "interference" },
        { primary: classifyPositionTacticalMotifs(supplied).motifs[0]?.id ?? null });
});

test.each([false, true])("clock 99 with only capturing replies is not an intended-move claim, reflected=%s", flip => {
    const supplied = input("3r2k1/p4ppp/1p6/2pq4/4R3/1P2PQ2/P5PP/6K1 w - - 98 24", ["e4e8", "d8e8", "f3d5"], flip);
    const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
    expect(steps).toHaveLength(3);
    expect(steps[0].after.halfmoves).toBe(99);
    expect(steps[1].after.halfmoves).toBe(0);
    record(`forced-capture-reset:${flip}`, supplied, { primary: "deflection" },
        { primary: classifyPositionTacticalMotifs(supplied).motifs[0]?.id ?? null });
});

test.each([false, true])("immediate mate takes precedence at the automatic-draw boundary, reflected=%s", flip => {
    const supplied = input("7k/8/5KQ1/8/8/8/8/8 w - - 149 1", ["g6g7"], flip);
    const steps = replayTacticalLine(supplied.fen, supplied.pvUci);
    expect(steps).toHaveLength(1);
    expect(steps[0].after.isCheckmate()).toBe(true);
    expect(steps[0].after.halfmoves).toBe(150);
    record(`immediate-mate:${flip}`, supplied, { primary: "mateIn1" },
        { primary: classifyPositionTacticalMotifs(supplied).motifs[0]?.id ?? null });
});
