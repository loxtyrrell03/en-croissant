import { afterAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSquare } from "chessops/util";
import { proveQuietIntermediateCapture, replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";
const initial = "r1r3k1/4pp1p/p1p1b1p1/qp1BP3/3P4/2P2N1P/P1Q2PPB/2b1K2R w K - 0 20";
const rows: Record<string, unknown>[] = [];
for (const reflected of [false, true]) for (const kind of ["original", "remove-c8", "remove-c1", "remove-e6", "queen-liability", "free-bishop"]) {
    test(`quiet intermediate certificate ${kind}; reflected=${reflected}`, () => {
        const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
        const board = Chess.fromSetup(parseFen(reflected ? reflectMixedForkFen(initial) : initial).unwrap()).unwrap();
        if (kind.startsWith("remove-")) board.board.take(parseSquare(flip(kind.slice(7)))!);
        if (kind === "free-bishop") board.board.take(parseSquare(flip("f7"))!);
        if (kind === "queen-liability") board.board.set(parseSquare(flip("c3"))!,
            { role: "rook", color: reflected ? "white" : "black" });
        const fen = makeFen(board.toSetup()), root = replayTacticalLine(fen, [flip("d5e6")])[0];
        const started = performance.now(), proof = proveQuietIntermediateCapture(root, 16383);
        rows.push({ kind, reflected, fen, elapsedMs: performance.now() - started, proof });
        expect(proof?.gain ?? null).toBe(["original", "remove-c8"].includes(kind) ? 230 : null);
        for (const leaf of [...proof?.collectionLeaves ?? [], ...proof?.recoveryLeaves ?? []]) {
            expect(replayTacticalLine(leaf.fen, [leaf.moveUci])[0].after.isCheck()).toBe(false);
            for (const answer of leaf.counterchecks ?? [])
                expect(replayTacticalLine(answer.fen, [answer.moveUci])[0].after.isCheck()).toBe(false);
        }
    });
}
afterAll(() => {
    const report = process.env.QUIET_INTERMEDIATE_PROOF_REPORT;
    if (report) writeFileSync(report, JSON.stringify(rows, null, 2), { flag: "wx" });
});
