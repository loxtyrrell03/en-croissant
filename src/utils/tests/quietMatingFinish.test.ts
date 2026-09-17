import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { quietMatingFinish } from "./fixtures/promotionCheckRetention";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";
import {
    proveCheckingMate,
    proveKingFlightMatingEntryDefence,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    buildMistakeReviewTacticalExplanation,
    classifyMistakeReviewMotifs,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";

function input(reflected: boolean) {
    const move = (value: string) => (reflected ? reflectMixedForkMove(value) : value);
    return {
        ...quietMatingFinish,
        fen: reflected ? reflectMixedForkFen(quietMatingFinish.fen) : quietMatingFinish.fen,
        playedMoveUci: move(quietMatingFinish.playedMoveUci),
        bestMoveUci: move(quietMatingFinish.bestMoveUci),
        pvUci: quietMatingFinish.pvUci.map(move),
        refutationUci: quietMatingFinish.refutationUci.map(move),
    };
}

function certificates(reflected: boolean) {
    const row = input(reflected);
    const actualRootFen = makeFen(
        replayTacticalLine(row.fen, [row.playedMoveUci])[0].after.toSetup(),
    );
    const rootFen = makeFen(replayTacticalLine(row.fen, [row.bestMoveUci])[0].after.toSetup());
    const steps = replayTacticalLine(actualRootFen, row.refutationUci);
    const entry = replayTacticalLine(rootFen, [row.refutationUci[0]])[0];
    return {
        row,
        actualRootFen,
        rootFen,
        steps,
        entry,
        mate: proveCheckingMate(steps, 65536, true),
        defence: proveKingFlightMatingEntryDefence(entry, 5, 32768, true),
    };
}

test.skipIf(
    !process.env.TACTICAL_QUIET_FINISH_OWNER || !process.env.TACTICAL_QUIET_FINISH_OWNER_REPORT,
)(
    "audit the changed owner king-flight cause with independent complete strategies",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const path = privateReportPath(process.env.TACTICAL_QUIET_FINISH_OWNER_REPORT!);
        expect(existsSync(path)).toBe(false);
        const report = JSON.parse(readFileSync(process.env.TACTICAL_QUIET_FINISH_OWNER!, "utf8"));
        const row = report.results.find(
            (r: any) => r.id === process.env.TACTICAL_QUIET_FINISH_OWNER_ID,
        );
        expect(row).toBeDefined();
        const actualRootFen = makeFen(
            replayTacticalLine(row.fen, [row.playedMoveUci])[0].after.toSetup(),
        );
        const rootFen = makeFen(
            replayTacticalLine(row.fen, [row.before[0].pvUci[0]])[0].after.toSetup(),
        );
        const line = row.after[0].pvUci;
        const mating = {
            cases: [
                {
                    id: "owner-king-flight-cause",
                    fen: actualRootFen,
                    pvUci: line,
                    tacticalHistory: {
                        ...row.tacticalHistory,
                        moves: [...row.tacticalHistory.moves, row.playedMoveUci],
                    },
                    proof: proveCheckingMate(replayTacticalLine(actualRootFen, line), 65536, true),
                },
            ],
        };
        const avoidance = {
            cases: [
                {
                    id: "owner-king-flight-cause",
                    kind: "king-flight",
                    rootFen,
                    actualRootFen,
                    entry: line[0],
                    proof: proveKingFlightMatingEntryDefence(
                        replayTacticalLine(rootFen, [line[0]])[0],
                        5,
                        32768,
                        true,
                    ),
                },
            ],
        };
        expect(mating.cases[0].proof).not.toBeNull();
        expect(avoidance.cases[0].proof).not.toBeNull();
        const inspect = (script: string, value: unknown) =>
            spawnSync(process.env.TACTICAL_MATE_STRATEGY_PYTHON ?? "python", [script], {
                input: JSON.stringify(value),
                encoding: "utf8",
            });
        const m = inspect("scripts/benchmarks/verify-mating-strategy.py", mating);
        const d = inspect("scripts/benchmarks/verify-mate-avoidance.py", avoidance);
        expect({
            mating: m.status,
            matingError: m.stderr,
            defence: d.status,
            defenceError: d.stderr,
        }).toEqual({ mating: 0, matingError: "", defence: 0, defenceError: "" });
        writeFileSync(
            path,
            JSON.stringify(
                {
                    mating,
                    avoidance,
                    matingVerification: JSON.parse(m.stdout),
                    defenceVerification: JSON.parse(d.stdout),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        process.stdout.write(
            JSON.stringify({ mating: JSON.parse(m.stdout), defence: JSON.parse(d.stdout) }) + "\n",
        );
    },
    120000,
);

test.each([false, true])(
    "quiet three-move finish and new king flight support the primary cause: reflected=%s",
    (reflected) => {
        const c = certificates(reflected);
        expect(c.mate).toMatchObject({ maxMoves: 5 });
        expect(c.mate!.visits).toBeLessThanOrEqual(65536);
        expect(c.defence).toMatchObject({ move: reflected ? "h2h3" : "h7h6", maxMoves: 5 });
        expect(c.defence!.visits).toBeLessThanOrEqual(32768);
        const result = classifyMistakeReviewMotifs(c.row);
        expect(buildMistakeReviewTacticalExplanation(result)?.primary).toMatchObject({
            id: "mateIn5",
            source: "allowed",
            comparison: "prevented",
        });
        expect(result.missedMotifs.some((m) => m.id === "promotion")).toBe(true);
        expect(buildMistakeReviewTacticalExplanation(result)?.secondary).toMatchObject({
            id: "promotion",
            source: "missed",
        });
        const scan = buildLiveTacticalScan({
            fen: c.actualRootFen,
            pvUci: c.row.refutationUci,
            engineName: "Constructed alternative",
            depth: 20,
        });
        expect(scan.motifs[0]).toMatchObject({ id: "mateIn5", ply: 1 });
        expect(scan.arrows.map((a) => a.from + a.to)).toEqual([c.row.refutationUci[0]]);
    },
);

test.each([false, true])(
    "a cooperative mate does not override a root capture or draw claim: reflected=%s",
    (reflected) => {
        const c = certificates(reflected);
        const original = replayTacticalLine(quietMatingFinish.fen, [
            quietMatingFinish.playedMoveUci,
        ])[0];
        const start = makeFen(original.after.toSetup());
        const capture = start.replace("4RP2", "3nRP2");
        for (const fen of [capture, start.replace(/ \d+ \d+$/, " 99 38")]) {
            const actual = reflected ? reflectMixedForkFen(fen) : fen;
            const steps = replayTacticalLine(actual, c.row.refutationUci);
            expect(steps).toHaveLength(c.row.refutationUci.length);
            expect(steps.at(-1)!.after.isCheckmate()).toBe(true);
            expect(proveCheckingMate(steps)).toBeNull();
        }
        // Kh8 is legal in the mating position, but it does not avoid mate.
        expect(proveKingFlightMatingEntryDefence(c.steps[0], 5)).toBeNull();
    },
);

test("invalid, exhausted and out-of-horizon work cannot become defensive proof", () => {
    const c = certificates(false);
    for (const budget of [0, 1, -1, NaN, Infinity]) {
        expect(proveCheckingMate(c.steps, budget)).toBeNull();
        expect(proveKingFlightMatingEntryDefence(c.entry, 5, budget)).toBeNull();
    }
    for (const horizon of [0, 1, 6, NaN, Infinity])
        expect(proveKingFlightMatingEntryDefence(c.entry, horizon)).toBeNull();
});

test.skipIf(!process.env.TACTICAL_QUIET_FINISH_REPORT)(
    "export independent mating and escape strategies",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const path = privateReportPath(process.env.TACTICAL_QUIET_FINISH_REPORT!);
        expect(existsSync(path)).toBe(false);
        const records = [false, true].map((reflected) => ({
            id: `constructed-mating-finish:${reflected}`,
            ...certificates(reflected),
        }));
        const mating = {
            cases: records.map((c) => ({
                id: c.id,
                fen: c.actualRootFen,
                pvUci: c.row.refutationUci,
                proof: c.mate,
            })),
        };
        const avoidance = {
            cases: records.map((c) => ({
                id: c.id,
                kind: "king-flight",
                rootFen: c.rootFen,
                actualRootFen: c.actualRootFen,
                entry: c.row.refutationUci[0],
                proof: c.defence,
            })),
        };
        const inspect = (script: string, value: unknown) =>
            spawnSync(process.env.TACTICAL_MATE_STRATEGY_PYTHON ?? "python", [script], {
                input: JSON.stringify(value),
                encoding: "utf8",
            });
        const m = inspect("scripts/benchmarks/verify-mating-strategy.py", mating);
        const d = inspect("scripts/benchmarks/verify-mate-avoidance.py", avoidance);
        expect({
            mating: m.status,
            matingError: m.stderr,
            defence: d.status,
            defenceError: d.stderr,
        }).toEqual({ mating: 0, matingError: "", defence: 0, defenceError: "" });
        const incomplete = structuredClone(avoidance);
        incomplete.cases[0].proof!.strategy!.nodes[
            incomplete.cases[0].proof!.strategy!.start
        ].children!.pop();
        expect(inspect("scripts/benchmarks/verify-mate-avoidance.py", incomplete).status).not.toBe(
            0,
        );
        const falseMate = structuredClone(mating);
        falseMate.cases[0].proof!.strategy!.replies = [];
        expect(inspect("scripts/benchmarks/verify-mating-strategy.py", falseMate).status).not.toBe(
            0,
        );
        writeFileSync(
            path,
            JSON.stringify(
                {
                    mating,
                    avoidance,
                    matingVerification: JSON.parse(m.stdout),
                    defenceVerification: JSON.parse(d.stdout),
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
        process.stdout.write(
            JSON.stringify({ mating: JSON.parse(m.stdout), defence: JSON.parse(d.stdout) }) + "\n",
        );
    },
    120000,
);
