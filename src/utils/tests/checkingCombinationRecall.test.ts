import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import { checkingCombinationCases, promotionCaptureForkCases } from "./fixtures/checkingCombinationRecall";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    replayTacticalLine,
    proveQuietMatingAttack,
    proveMatingCaptureAttack,
    proveImmediateFork,
    proveCheckingMate,
    proveCheckingCombination,
} from "../tacticalMotifs/causalTactics";

test.each([false, true])("connected checking attacks and promotion captures: reflected=%s", (reflected) => {
    for (const [kind, rows] of [["combination", checkingCombinationCases], ["fork", promotionCaptureForkCases]] as const) {
        for (const row of rows) {
            const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
            const moves = reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci;
            const steps = replayTacticalLine(fen, moves);
            expect(steps).toHaveLength(moves.length);
            const proof = kind === "combination" ? proveCheckingCombination(steps) : proveImmediateFork(steps[0]);
            expect({ id: row.id, proved: Boolean(proof) }).toEqual({ id: row.id, proved: row.positive });
            expect(proof?.gain ?? 300).toBeGreaterThanOrEqual(300);
        }
    }
});

test("checking combination nomination and exhausted budgets cannot borrow cached success", () => {
    const row = checkingCombinationCases[0];
    const steps = replayTacticalLine(row.fen, row.pvUci);
    const proof = proveCheckingCombination(steps)!;
    expect(proof).not.toBeNull();
    expect(proof.visits).toBeLessThanOrEqual(32768);
    expect(proof.gain).toBe(Math.min(...proof.branches.map(branch => branch.gain)));
    expect(proof.branches).toHaveLength([...steps[0].after.allDests()].reduce((n, [, dests]) => n + [...dests].length, 0));
    for (const limit of [0, -1, 1, 1.5, NaN, Infinity]) expect(proveCheckingCombination(steps, limit)).toBeNull();
    expect(proveCheckingCombination(steps.slice(0, 1))).toBeNull();
    expect(proveCheckingCombination(steps)).toEqual(proof);
});

test("a promotion fork is immediate, while the stalemating capture is not a win", () => {
    const positive = promotionCaptureForkCases[0];
    const classified = classifyPositionTacticalMotifs({ fen: positive.fen, pvUci: positive.pvUci });
    expect(classified.motifs[0]).toMatchObject({ id: "fork", ply: 1, value: 1400 });
    expect(classified.timeline).toContainEqual(expect.objectContaining({ id: "discoveredCheck", ply: 1 }));
    const stale = replayTacticalLine(promotionCaptureForkCases[2].fen, ["b6b7", "a8a7", "b7c8q"]);
    expect(stale).toHaveLength(3);
    expect(stale[2].after.isEnd()).toBe(true);
    expect(stale[2].after.isCheckmate()).toBe(false);
});

test("the public engine receipt checks the current selected combination answers", () => {
    const receipt = JSON.parse(readFileSync("benchmarks/tactical-relevance/checking-combination-stockfish-18.json", "utf8"));
    const records = new Map<string, { cp: number | null; mate: number | null; depth: number }>(
        receipt.searches.map((row: any) => [`${row.fen}:${row.move ?? ""}`, row]),
    );
    for (const reflected of [false, true]) {
        const row = checkingCombinationCases[0];
        const fen = reflected ? reflectMixedForkFen(row.fen) : row.fen;
        const pv = reflected ? row.pvUci.map(reflectMixedForkMove) : row.pvUci;
        const proof = proveCheckingCombination(replayTacticalLine(fen, pv))!;
        expect(proof).not.toBeNull();
        for (const decision of [{ fen, move: pv[0] }, ...proof.decisions]) {
            const evidence = records.get(`${decision.fen}:${decision.move}`)!;
            expect(evidence).toBeDefined();
            expect(evidence.depth).toBe(16);
            expect((evidence.cp ?? -Infinity) > 0 || (evidence.mate ?? -Infinity) > 0).toBe(true);
        }
    }
});

test.skipIf(!process.env.TACTICAL_COMBINATION_VERIFICATION || !process.env.TACTICAL_COMBINATION_ENGINE_REPORTS)(
    "fresh private engine witnesses match every retained certificate and owner explanation",
    () => {
        const report = JSON.parse(readFileSync(process.env.TACTICAL_COMBINATION_VERIFICATION!, "utf8"));
        const paths: string[] = JSON.parse(process.env.TACTICAL_COMBINATION_ENGINE_REPORTS!);
        const searches = paths.flatMap(path => JSON.parse(readFileSync(path, "utf8")).searches);
        const records = new Map(searches.map(row => [`${row.fen}:${row.searchMove ?? ""}`, row.lines[0]]));
        for (const row of report.cases) {
            const steps = replayTacticalLine(row.fen, row.pvUci);
            const proof = proveCheckingCombination(steps);
            const quiet = (steps[0].capture ? proveMatingCaptureAttack : proveQuietMatingAttack)(steps[0]);
            const fork = proveImmediateFork(steps[0]);
            expect({ proof, quiet, fork }).toEqual({ proof: row.proof, quiet: row.quiet, fork: row.fork });
            for (const probe of row.probes) {
                const evidence = records.get(`${probe.fen}:${probe.searchMove ?? ""}`);
                expect({ id: probe.id, depth: evidence?.depth }).toEqual({ id: probe.id, depth: 16 });
                if (proof || quiet || fork) assert((evidence.cp ?? -Infinity) > 0 || (evidence.mate ?? -Infinity) > 0, probe.id);
            }
        }
        const owner = JSON.parse(readFileSync(process.env.TACTICAL_COMBINATION_OWNER_REPLAY!, "utf8"));
        const allowed = owner.results.find((row: any) => row.ply === 29 && row.playedMoveUci === "b7b5");
        const missed = owner.results.find((row: any) => row.game === allowed.game && row.ply === 30);
        expect(allowed.explanation.primary).toMatchObject({ id: "forcingAttack", source: "allowed", comparison: "prevented" });
        expect(missed.explanation.primary).toMatchObject({ id: "mateIn2", source: "allowed" });
        expect(missed.explanation.secondary).toMatchObject({ id: "forcingAttack", source: "missed" });
    }, 30000,
);

test.skipIf(!process.env.TACTICAL_CHECKING_GAP_ENGINE || !process.env.TACTICAL_COMBINATION_LEAF_REPORT)(
    "inspect the missed combination's independently nominated branch mechanisms",
    async () => {
        const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_COMBINATION_LEAF_REPORT!);
        const receipt = JSON.parse(readFileSync(process.env.TACTICAL_CHECKING_GAP_ENGINE!, "utf8"));
        const branch = (suffix: string) => receipt.searches.find((row: any) => row.id.endsWith(suffix));
        const quiet = branch(":reply-c8b8");
        const promotion = branch(":accepted-c7d8");
        const mate = branch(":reply-c8d7");
        const attack = branch(":after-best");
        const quietSteps = replayTacticalLine(quiet.fen, quiet.lines[0].pvUci);
        expect(quietSteps[2].san).toBe("Re7");
        const traces: string[] = [];
        const result = {
            combination: [32768].map((limit) => ({ limit, proof: proveCheckingCombination(replayTacticalLine(attack.fen, attack.lines[0].pvUci), limit, (message) => traces.push(message)) })),
            quiet: [8192, 32768].map((limit) => ({ limit, proof: proveQuietMatingAttack(quietSteps[2], limit, (message) => traces.push(message)) })),
            promotion: proveImmediateFork(replayTacticalLine(promotion.fen, promotion.lines[0].pvUci)[0]),
            mate: proveCheckingMate(replayTacticalLine(mate.fen, mate.lines[0].pvUci)),
            traces,
        };
        writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    },
);

test.skipIf(!process.env.TACTICAL_COMBINATION_DIAGNOSTIC)("audit recovered checks and contrary controls", async () => {
    const { privateReportPath } = await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output = privateReportPath(process.env.TACTICAL_COMBINATION_DIAGNOSTIC!);
    const ordinary = JSON.parse(readFileSync("benchmarks/tactical-relevance/ordinary-adjacent-stockfish-18.json", "utf8"))
        .find((row: any) => row.id === "ordinary-2:ply14");
    const longMate = JSON.parse(readFileSync("benchmarks/tactical-relevance/quiet-mate-development.json", "utf8"))
        .cases.find((row: any) => row.id === "lichess:0rcU4");
    const promotionMate = JSON.parse(readFileSync("benchmarks/tactical-relevance/ordinary-games-stockfish-18.json", "utf8"))
        .find((row: any) => row.id === "ordinary-2:ply18");
    const rows = [
        ...checkingCombinationCases,
        ...promotionCaptureForkCases,
        { id: "shielded-king", fen: "2kr1b1r/p5p1/2p2P2/1p4Bp/Q3R1b1/8/5PPP/R5K1 w - - 0 1", pvUci: checkingCombinationCases[0].pvUci },
        { id: ordinary.id, fen: ordinary.fen, pvUci: ordinary.after[0].pvUci },
        { id: longMate.id, fen: longMate.startFen, pvUci: longMate.bestLine },
        { id: promotionMate.id, fen: promotionMate.fen, pvUci: promotionMate.after[0].pvUci },
    ];
    if (process.env.TACTICAL_CHECKING_GAP_ENGINE) {
        const receipt = JSON.parse(readFileSync(process.env.TACTICAL_CHECKING_GAP_ENGINE, "utf8"));
        const attack = receipt.searches.find((row: any) => row.id.endsWith(":after-best"));
        rows.push({ id: "owner-checking-combination", fen: attack.fen, pvUci: attack.lines[0].pvUci });
        const quiet = receipt.searches.find((row: any) => row.id.endsWith(":reply-c8b8"));
        const quietSteps = replayTacticalLine(quiet.fen, quiet.lines[0].pvUci);
        rows.push({ id: "owner-supporting-threat", fen: makeFen(quietSteps[2].before.toSetup()), pvUci: quiet.lines[0].pvUci.slice(2) });
        const promotion = receipt.searches.find((row: any) => row.id.endsWith(":accepted-c7d8"));
        rows.push({ id: "owner-promotion-fork", fen: promotion.fen, pvUci: promotion.lines[0].pvUci });
    }
    if (process.env.TACTICAL_COMBINATION_COURSE_REPLAY) {
        const receipt = JSON.parse(readFileSync(process.env.TACTICAL_COMBINATION_COURSE_REPLAY, "utf8"));
        const row = receipt.results.flatMap((group: any) => group.cases).find((row: any) => row.id === "private-easy:153");
        const steps = replayTacticalLine(row.fen, row.engineLines[0].pvUci);
        assert.equal(steps[2].san, "Rxe7");
        rows.push({ id: "course-supporting-threat", fen: makeFen(steps[2].before.toSetup()), pvUci: row.engineLines[0].pvUci.slice(2) });
    }
    const reflectedRows = rows.map(row => {
        const fields = reflectMixedForkFen(row.fen).split(" ");
        fields[2] = fields[2].replace(/[a-zA-Z]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
        fields[3] = reflectMixedForkMove(fields[3]);
        return { ...row, id: `${row.id}:reflected`, fen: fields.join(" "), pvUci: row.pvUci.map(reflectMixedForkMove) };
    });
    const cases = [...rows, ...reflectedRows].map(row => {
        const steps = replayTacticalLine(row.fen, row.pvUci);
        expect({ id: row.id, plies: steps.length }).toEqual({ id: row.id, plies: row.pvUci.length });
        const traces: string[] = [];
        const proof = proveCheckingCombination(steps, 32768, message => traces.push(message));
        const quiet = (steps[0].capture ? proveMatingCaptureAttack : proveQuietMatingAttack)(steps[0], 8192, message => traces.push(message));
        const fork = proveImmediateFork(steps[0]);
        const decisions = [...(proof?.decisions ?? []), ...(quiet?.decisions ?? [])];
        for (const branch of fork?.branches ?? []) {
            if (!branch.captureUci) continue;
            const pos = steps[0].after.clone();
            pos.play(parseUci(branch.replyUci)!);
            decisions.push({ fen: makeFen(pos.toSetup()), move: branch.captureUci });
        }
        // The root and every legal first defence are checked separately from
        // the attacking decisions retained in the bounded certificate.
        for (const [from, dests] of (proof || quiet) ? steps[0].after.allDests() : []) for (const to of dests) {
            const reply = { from, to };
            const after = steps[0].after.clone();
            after.play(reply);
            decisions.push({ fen: makeFen(after.toSetup()), move: "" });
        }
        const unique = [...new Map(decisions.map(decision => [`${decision.fen}:${decision.move}`, decision])).values()];
        const probes = [
            { id: `${row.id}:root`, fen: row.fen, searchMove: row.pvUci[0] },
            ...unique.map((decision, i) => ({ id: `${row.id}:decision-${i}`, fen: decision.fen, ...(decision.move ? { searchMove: decision.move } : {}) })),
        ];
        return { ...row, proof, quiet, fork, traces, result: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: row.pvUci }), probes };
    });
    writeFileSync(output, JSON.stringify({ samplePath: "benchmarks/tactical-relevance/quiet-mate-development.json", cases,
        probes: cases.flatMap(row => row.probes) }, null, 2) + "\n", { flag: "wx" });
}, 30000);
