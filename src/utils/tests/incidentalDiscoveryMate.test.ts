import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { makeUci } from "chessops/util";
import {
    proveShortCheckingMate,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs, MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION } from "../tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

// Public development puzzle ZrgCo (CC0, game wOOnQcXR), independently
// adjudicated before this patch. The a7 pawn is not part of the mating net.
const fen = "8/p3P2R/1p1k4/2p2K1p/2P4r/1P6/P7/7q w - - 0 53";
const line = ["e7e8n", "d6c6", "h7c7"];
const withoutPawn = fen.replace("p3P2R", "4P2R");
const report: { id: string; fen: string; pvUci: string[]; expected: unknown; actual: unknown; pass: boolean }[] = [];
afterAll(() => {
    if (!process.env.TACTICAL_INCIDENTAL_DISCOVERY_REPORT) return;
    const source = readFileSync("src/utils/tacticalMotifs/causalTactics.ts", "utf8").replace(/\r\n/g, "\n");
    writeFileSync(process.env.TACTICAL_INCIDENTAL_DISCOVERY_REPORT, JSON.stringify({
        classifierVersion: MISTAKE_REVIEW_MOTIF_CLASSIFIER_VERSION,
        sourceSha256LF: createHash("sha256").update(source).digest("hex"),
        scope: "Public/synthetic causal-attribution contracts, not a population or holdout accuracy estimate.",
        contracts: report.length, passed: report.filter(row => row.pass).length, cases: report,
    }, null, 2), { flag: "wx" });
});
function input(position: string, pv: string[], flip: boolean) {
    return { fen: flip ? reflectMixedForkFen(position) : position, pvUci: flip ? pv.map(reflectMixedForkMove) : pv };
}
function record(id: string, row: { fen: string; pvUci: string[] }, expected: unknown, actual: unknown) {
    report.push({ id, ...row, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) });
    expect(actual).toEqual(expected);
}

for (const missing of [false, true]) test.each([false, true])(
    `the identical underpromotion mates after every legal reply, missingPawn=${missing}, reflected=%s`, flip => {
        const row = input(missing ? withoutPawn : fen, line, flip);
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect(steps).toHaveLength(3);
        const root = steps[0];
        const replies = [...root.after.allDests()].flatMap(([from, dests]) => [...dests].map(to => ({ from, to })));
        const branches = replies.map(reply => {
            const next = root.after.clone(); next.play(reply);
            const mates = [...next.allDests()].flatMap(([from, dests]) => [...dests].map(to => ({ from, to })))
                .filter(move => { const finish = next.clone(); finish.play(move); return finish.isCheckmate(); });
            return { reply: makeUci(reply), mates: mates.map(makeUci) };
        });
        record(`independent-mate:${missing}:${flip}`, row,
            { branches: [{ reply: row.pvUci[1], mates: [row.pvUci[2]] }], distance: 2 },
            { branches, distance: proveShortCheckingMate(root, 4096)?.maxMoves ?? null });
    },
);

for (const missing of [false, true]) for (const plies of [1, 3]) test.each([false, true])(
    `mate and underpromotion stay; incidental pawn discovery does not, missingPawn=${missing}, plies=${plies}, reflected=%s`, flip => {
        const row = input(missing ? withoutPawn : fen, line.slice(0, plies), flip);
        expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(plies);
        const result = classifyPositionTacticalMotifs(row);
        const roots = result.motifs.filter(m => m.ply === 1).map(m => m.id);
        record(`underpromotion-labels:${missing}:${plies}:${flip}`, row,
            { primary: "mateIn2", underpromotion: true, discovery: false, timelineDiscovery: false },
            { primary: roots[0] ?? null, underpromotion: roots.includes("underPromotion"),
                discovery: roots.includes("discoveredAttack"),
                timelineDiscovery: Boolean(result.timeline?.some(m => m.ply === 1 && m.id === "discoveredAttack")) });
    },
);

const controls = [
    {
        id: "nonmating-material-discovery",
        fen: "4q1k1/5ppp/8/8/4B3/8/5PPP/4R1K1 w - - 0 1",
        line: ["e4h7", "g8h7", "e1e8"], motif: "discoveredAttack",
    },
    {
        id: "mating-discovered-check",
        fen: "3rkr2/5p2/8/8/6B1/8/4B3/4R1K1 w - - 0 1",
        line: ["e2d3"], motif: "discoveredCheck",
    },
    {
        id: "mating-double-check",
        fen: "3rkr2/5p2/8/8/8/8/4B3/4R1K1 w - - 0 1",
        line: ["e2b5"], motif: "doubleCheck",
    },
    {
        id: "supporting-mating-clearance",
        fen: "8/8/2k1B3/2b4r/p7/Pp4B1/1P2bPP1/R1K1R3 b - - 0 34",
        line: ["c5e3", "f2e3", "h5c5", "e6c4", "c5c4", "c1b1", "e2d3"], motif: "clearance",
    },
    {
        // Rxa7 collects the very victim proposed for removal. Its legal but
        // nonmating displayed continuation is not the unchanged mate witness.
        id: "displayed-capture-of-probed-victim",
        fen, line: ["e7e8n", "d6c6", "h7a7"], motif: "discoveredAttack",
    },
];
for (const control of controls) test.each([false, true])(`${control.id}, reflected=%s`, flip => {
    const row = input(control.fen, control.line, flip);
    expect(replayTacticalLine(row.fen, row.pvUci)).toHaveLength(row.pvUci.length);
    const result = classifyPositionTacticalMotifs(row);
    record(`${control.id}:${flip}`, row, { retained: true },
        { retained: Boolean(result.timeline?.some(m => m.ply === 1 && m.id === control.motif)) });
});
