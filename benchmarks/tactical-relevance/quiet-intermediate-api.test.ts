import { afterAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { replayTacticalLine } from "../../src/utils/tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";

// All imported production APIs exist at exact173. These fixed contracts are
// development-case recall/accounting checks, not population accuracy.
const previous = "r1r3k1/4pp1p/p1p1b1pb/qp1BP3/3P4/2P2N1P/P1Q2PPB/2R1K2R b K - 0 19";
const rows: Record<string, unknown>[] = [];
for (const reflected of [false, true]) for (const withHistory of [false, true]) for (const length of [1, 3]) {
    test(`Ltbye public API: reflected=${reflected}, history=${withHistory}, plies=${length}`, () => {
        const flip = (move: string) => reflected ? reflectMixedForkMove(move) : move;
        const previousFen = reflected ? reflectMixedForkFen(previous) : previous;
        const previousMoveUci = flip("h6c1");
        const fen = makeFen(replayTacticalLine(previousFen, [previousMoveUci])[0].after.toSetup());
        const pvUci = ["d5e6", "f7e6", "c2c1"].slice(0, length).map(flip);
        const result = classifyPositionTacticalMotifs({ fen, pvUci,
            ...(withHistory ? { previousFen, previousMoveUci,
                tacticalHistory: { fen: previousFen, moves: [previousMoveUci] } } : {}) });
        const compact = ({ id, label, ply, value, moveUci }: typeof result.motifs[number]) => ({ id, label, ply, value, moveUci });
        const primary = result.motifs[0], value = withHistory ? 0 : 230;
        rows.push({ reflected, withHistory, length, motifs: result.motifs.map(compact),
            timeline: result.timeline?.map(compact), contract: primary?.id === "intermezzo" &&
                primary.label === "Intermediate Capture" && primary.ply === 1 && primary.value === value });
        expect(primary).toMatchObject({ id: "intermezzo", label: "Intermediate Capture", ply: 1, value });
    });
}
afterAll(() => {
    const report = process.env.QUIET_INTERMEDIATE_API_REPORT;
    if (report) writeFileSync(report, JSON.stringify({
        sourceRef: process.env.RARE_CAUSAL_COHORT_V2_REF ?? "current worktree",
        contracts: rows.length, passed: rows.filter(row => row.contract).length, rows,
    }, null, 2), { flag: "wx" });
});
