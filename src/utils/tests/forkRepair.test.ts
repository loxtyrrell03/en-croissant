import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { proveImmediateFork, proveRepairedFork, replayTacticalLine } from "../tacticalMotifs/causalTactics";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { classifyPositionTacticalMotifs, classifyMistakeReviewMotifs, buildMistakeReviewTacticalExplanation } from "../tacticalMotifs/mistakeReviewAdapter";
import { forkRepairFen as fen, forkRepairCases } from "./fixtures/forkRepair";


test("a real checking fork saves its attacked queen before collecting a rook", () => {
    const root = replayTacticalLine(fen, ["d5f6"])[0];
    expect(proveImmediateFork(root)).toBeNull();
    const failures: string[] = [];
    const proof = proveRepairedFork(root, 8192, reason => failures.push(reason));
    if (process.env.TACTICAL_FORK_REPAIR_REPORT) {
        writeFileSync(process.env.TACTICAL_FORK_REPAIR_REPORT, JSON.stringify({
            proof, failures,
            samplePath: process.env.TACTICAL_RECALL_SAMPLE,
            probes: [...new Map(proof?.decisions.map(decision => [`${decision.fen}:${decision.moveUci}`, decision])).values()].map((decision, index) => ({
                id: `tA2XR-${index}-${decision.kind}`, fen: decision.fen, searchMove: decision.moveUci,
            })),
        }, null, 2), { flag: "wx" });
    }
    expect(proof).not.toBeNull();
});

test.each([false, true])("the repaired fork preserves both-colour branches: reflected=%s", reflected => {
    const root = replayTacticalLine(reflected ? reflectMixedForkFen(fen) : fen,
        [reflected ? reflectMixedForkMove("d5f6") : "d5f6"])[0];
    const proof = proveRepairedFork(root);
    expect(proof).not.toBeNull();
    expect(proof?.branches).toHaveLength(2);
    expect(proof?.gain).toBe(100);
    expect(proof?.visits).toBeLessThan(8192);
    expect(proveRepairedFork(root, 1)).toBeNull();
});

test.each([false, true])("a missing mating rook or obstructed mating file cannot rescue the fork: reflected=%s", reflected => {
    for (const { fen: control } of forkRepairCases.filter(row => !row.positive)) {
        const root = replayTacticalLine(reflected ? reflectMixedForkFen(control) : control,
            [reflected ? reflectMixedForkMove("d5f6") : "d5f6"])[0];
        expect(root).toBeTruthy();
        expect(proveRepairedFork(root)).toBeNull();
    }
});

test("claims and custom exhausted budgets cannot borrow a cached repair proof", () => {
    const root = replayTacticalLine(fen, ["d5f6"])[0];
    expect(proveRepairedFork(root)).not.toBeNull();
    for (const budget of [0, -1, 1, 1.5]) expect(proveRepairedFork(root, budget)).toBeNull();
    const claim = replayTacticalLine(fen.replace("3 33", "98 33"), ["d5f6"])[0];
    expect(proveRepairedFork(claim)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_FORK_REPAIR_ENGINE_REPORT)("fresh engine witnesses match the selected public proof", () => {
    const proof = proveRepairedFork(replayTacticalLine(fen, ["d5f6"])[0])!;
    const report = JSON.parse(readFileSync(process.env.TACTICAL_FORK_REPAIR_ENGINE_REPORT!, "utf8"));
    const selected = new Set(proof.decisions.map(decision => `${decision.fen}:${decision.moveUci}`));
    expect(report.completed).toBe(report.requested);
    expect(new Set(report.searches.map((row: any) => `${row.fen}:${row.searchMove}`))).toEqual(selected);
    for (const row of report.searches) {
        const line = row.lines[0];
        expect(line.pvUci[0]).toBe(row.searchMove);
        expect(line.depth).toBe(16);
        expect({ id: row.id, acceptable: line.cp !== null ? line.cp >= 0 : line.mate > 0 }).toEqual({ id: row.id, acceptable: true });
    }
    if (process.env.TACTICAL_FORK_REPAIR_PUBLIC_REPORT) {
        writeFileSync(process.env.TACTICAL_FORK_REPAIR_PUBLIC_REPORT, JSON.stringify({
            scope: "Public real-game fork repair development audit. Full-position depth-16 estimates validate the selected moves; they are not the local material bound or an accuracy score.",
            source: "https://lichess.org/heingGcp/black#64", puzzle: "tA2XR", engine: "Stockfish 18", depth: 16,
            gain: proof.gain, visits: proof.visits, branches: proof.branches,
            searches: report.searches.map((row: any) => ({ fen: row.fen, move: row.searchMove, cp: row.lines[0].cp, mate: row.lines[0].mate, pvUci: row.lines[0].pvUci })),
        }, null, 2), { flag: "wx" });
    }
});

test("root-only and supplied quiet continuation retain the same immediate fork", () => {
    for (const pvUci of [["d5f6"], ["d5f6", "g8h8", "b3f7"], ["d5f6", "g8f8", "b3g8"]]) {
        const result = classifyPositionTacticalMotifs({ fen, pvUci });
        expect(result.motifs[0]).toMatchObject({ id: "fork", value: 100, ply: 1, verifiedCombination: true });
        expect(result.motifs[0].evidence).toContain("Qf7 preserves the threat");
        expect(result.motifs[0].evidence).toContain("Qg8+ preserves the threat");
    }
});

test("the board draws the existing fork, not future queen repairs or mating moves", () => {
    const scan = buildLiveTacticalScan({ fen, pvUci: ["d5f6", "g8h8", "b3f7"], depth: 16, engineName: "Real-game fixture" });
    expect(scan.motifs[0]).toMatchObject({ id: "fork", ply: 1 });
    expect(scan.arrows.map(arrow => arrow.from + arrow.to)).toEqual(["d5f6", "f6e4", "f6e8", "f6g8"]);
});

test("mistake review retains the missed repaired fork alongside the larger opponent cause", () => {
    const review = classifyMistakeReviewMotifs({
        fen, playedMoveUci: "a2a3", bestMoveUci: "d5f6",
        pvUci: ["d5f6", "g8h8", "b3f7"], refutationUci: ["c5b3"],
    });
    expect(review.missedMotifs[0]).toMatchObject({ id: "fork", value: 100, ply: 1 });
    const explanation = buildMistakeReviewTacticalExplanation(review);
    expect(explanation?.primary).toMatchObject({ source: "allowed", moveUci: "c5b3" });
    expect(explanation?.primary.value).toBeGreaterThanOrEqual(900);
    expect(explanation?.secondary).toMatchObject({ id: "fork", source: "missed" });
});
