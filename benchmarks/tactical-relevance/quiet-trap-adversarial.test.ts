import { afterAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { attacks } from "chessops/attacks";
import { parseSquare } from "chessops/util";
import { proveQuietClearancePreparation, replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";

const selection = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-trap-adversarial-selection.json", "utf8")) as {
    cases: { id: string; startFen: string; bestLine: string[] }[];
};
const observations: unknown[] = [];
afterAll(() => {
    const path = process.env.QUIET_TRAP_ADVERSARIAL_REPORT;
    if (!path) return;
    const hashes = Object.fromEntries(["causalTactics.ts", "quietClearancePreparation.ts", "mistakeReviewAdapter.ts"].map(name => [
        name, createHash("sha256").update(readFileSync(`src/utils/tacticalMotifs/${name}`, "utf8").replace(/\r\n/g, "\n")).digest("hex"),
    ]));
    writeFileSync(path, JSON.stringify({ scope: "Fresh public development observations and narrow mechanism negatives; not gold-label accuracy",
        hashes, observations }, null, 2), { flag: "wx" });
});

for (const row of selection.cases) for (const reflected of [false, true]) {
    test(`fresh predeclared mechanism boundary ${row.id}, reflected=${reflected}`, () => {
        const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
        const fen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
        const line = row.bestLine.map(flip), steps = replayTacticalLine(fen, line);
        expect(steps).toHaveLength(line.length);
        const root = classifyPositionTacticalMotifs({ fen, pvUci: [line[0]] });
        const full = classifyPositionTacticalMotifs({ fen, pvUci: line });
        observations.push({ id: row.id, reflected, fen, line, root, full });
        // None of these six roots is the admitted knight + new major-target
        // preparation. This makes no assertion about broader clearance motifs.
        expect(proveQuietClearancePreparation(steps[0])).toBeNull();
        expect([...root.motifs, ...full.motifs].filter(m => m.ply === 1 && m.label === "Clearance Preparation")).toEqual([]);
    });
}

for (const reflected of [false, true]) {
    test(`pre-existing blocked rook cannot borrow Qxh6 as new confinement; reflected=${reflected}`, () => {
        const row = selection.cases.find(item => item.id === "lichess:q4FtX")!;
        const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
        const fen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
        const step = replayTacticalLine(fen, [flip(row.bestLine[0])])[0];
        const before = step.before.clone();
        before.turn = step.after.turn;
        before.epSquare = undefined;
        const rook = parseSquare(flip("a1"))!;
        expect(before.dests(rook).size()).toBe(0);
        expect(step.after.dests(rook).size()).toBe(0);
        expect(classifyPositionTacticalMotifs({ fen, pvUci: row.bestLine.map(flip) }).motifs
            .filter(motif => motif.ply === 1 && motif.id === "trappedPiece")).toEqual([]);
    });
    test(`opening Re1-e8 alone cannot invent a knight attack on a major piece; reflected=${reflected}`, () => {
        const row = selection.cases.find(item => item.id === "lichess:2qDuS")!;
        const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
        const fen = reflected ? reflectMixedForkFen(row.startFen) : row.startFen;
        const step = replayTacticalLine(fen, [flip(row.bestLine[0])])[0];
        const attacked = [...attacks(step.after.board.get(step.move.to)!, step.move.to, step.after.board.occupied)];
        expect(attacked.filter(square => {
            const piece = step.after.board.get(square);
            return piece?.color === step.after.turn && ["rook", "queen"].includes(piece.role);
        })).toEqual([]);
        expect(proveQuietClearancePreparation(step)).toBeNull();
    });
}
