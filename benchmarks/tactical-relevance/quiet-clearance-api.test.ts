import { afterAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { classifyPositionTacticalMotifs } from "../../src/utils/tacticalMotifs/mistakeReviewAdapter";
import { reflectMixedForkFen, reflectMixedForkMove } from "../../src/utils/tests/fixtures/mixedTargetFork";

// Public-API-only contracts also run against exact adapter172. No new helper
// export is imported, so baseline misses measure actual observed nominations.
const fen = "8/2R3pp/5p2/4p3/rbNk4/6PP/5PK1/8 w - - 0 44";
const lines = {
    root: ["c4b2"],
    source: ["c4b2", "a4a1", "c7c4", "d4d5", "c4b4"],
    repair: ["c4b2", "b4d6", "c7c6", "d4d5", "c6d6", "d5d6", "b2a4"],
};
const rows: Record<string, unknown>[] = [];
for (const reflected of [false, true]) for (const [name, line] of Object.entries(lines)) {
    test(`public wN37d ${name}; reflected=${reflected}`, () => {
        const input = { fen: reflected ? reflectMixedForkFen(fen) : fen,
            pvUci: reflected ? line.map(reflectMixedForkMove) : line };
        const start = performance.now();
        const result = classifyPositionTacticalMotifs(input);
        const motifs = result.motifs.map(({ id, label, ply, value, moveUci }) => ({ id, label, ply, value, moveUci }));
        const first = motifs[0];
        rows.push({ name, reflected, elapsedMs: performance.now() - start, motifs,
            contract: first?.id === "clearance" && first.label === "Clearance Preparation" &&
                first.ply === 1 && first.value === 180 && first.moveUci === input.pvUci[0] });
        expect(first).toMatchObject({ id: "clearance", label: "Clearance Preparation", ply: 1,
            value: 180, moveUci: input.pvUci[0] });
    });
}
afterAll(() => {
    const report = process.env.QUIET_CLEARANCE_API_REPORT;
    if (report) writeFileSync(report, JSON.stringify({
        sourceRef: process.env.RARE_CAUSAL_COHORT_V2_REF ?? "current worktree",
        contractPassed: rows.filter(row => row.contract).length, contracts: rows.length, rows,
    }, null, 2));
});
