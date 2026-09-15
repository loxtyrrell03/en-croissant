import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { makeFen } from "chessops/fen";
import { makeSquare } from "chessops/util";
import {
    proveDiscoveredMaterial,
    proveDiscoveredTrap,
    proveExchangeDiscovery,
    provePinEntry,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";
import {
    classifyPositionTacticalMotifs,
    classifyMistakeReviewMotifs,
    buildMistakeReviewTacticalExplanation,
} from "../tacticalMotifs/mistakeReviewAdapter";
import { buildLiveTacticalScan } from "../tacticalMotifs/liveTactics";
import { discoveryTrapCases, discoveryTrapFen } from "./fixtures/discoveryTrap";
import { reflectMixedForkFen, reflectMixedForkMove } from "./fixtures/mixedTargetFork";

test.each(
    discoveryTrapCases.flatMap((row) => [
        row,
        {
            ...row,
            id: `${row.id}:black`,
            fen: reflectMixedForkFen(row.fen),
        },
    ]),
)("$id catches the same discovered target, not a different loose piece", (row) => {
    const move = row.id.endsWith(":black") ? reflectMixedForkMove("e2e4") : "e2e4";
    const steps = replayTacticalLine(row.fen, [move]);
    expect(steps).toHaveLength(1);
    const proof = proveDiscoveredTrap(steps[0]);
    expect(Boolean(proof)).toBe(row.positive);
    if (!proof) return;
    expect(proof.branches).toHaveLength(
        [...steps[0].after.allDests()].reduce((n, [, t]) => n + t.size(), 0),
    );
    expect(proof.gain).toBeGreaterThanOrEqual(100);
    for (const branch of proof.branches) {
        const line = replayTacticalLine(makeFen(steps[0].after.toSetup()), [
            branch.replyUci,
            branch.answerUci,
        ]);
        expect(line).toHaveLength(2);
        if (!branch.pinReplies) continue;
        expect(branch.pinReplies).toHaveLength(
            [...line[1].after.allDests()].reduce((n, [, t]) => n + t.size(), 0),
        );
        for (const defence of branch.pinReplies)
            expect(
                replayTacticalLine(makeFen(line[1].after.toSetup()), [
                    defence.replyUci,
                    defence.answerUci,
                ]),
            ).toHaveLength(2);
    }
    const scan = buildLiveTacticalScan({
        fen: row.fen,
        pvUci: [move],
        depth: 16,
        engineName: "Control",
    });
    expect(scan.motifs[0]).toMatchObject({ id: "discoveredAttack", ply: 1 });
    expect(scan.motifs[0].evidence).toMatch(/pins that same piece/);
    expect(scan.arrows).toContainEqual(
        expect.objectContaining({
            from: makeSquare(proof.ray.from),
            to: makeSquare(proof.ray.target),
            ply: 1,
        }),
    );
    expect(scan.arrows.some((arrow) => arrow.from === "b5" || arrow.from === "b4")).toBe(false);
});

test.each([0, 1, -1, NaN, Infinity, 1.5])(
    "discovered-trap budget %s cannot borrow cached proof",
    (limit) => {
        const step = replayTacticalLine(discoveryTrapFen, ["e2e4"])[0];
        expect(proveDiscoveredTrap(step)).not.toBeNull();
        expect(proveDiscoveredTrap(step, limit)).toBeNull();
    },
);

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY)(
    "owner discoveries recover missed lessons without inventing opponent causation",
    () => {
        const baseline = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        for (const ply of [7, 8, 27, 28]) {
            const row = baseline.results[ply];
            expect(row.ply).toBe(ply);
            const scan = buildLiveTacticalScan({
                ...row,
                ...row.before[0],
                variations: row.before,
                engineName: "Stockfish 18",
            });
            const owner = ply % 2 === 0;
            expect(scan.motifs.some((m) => m.id === "discoveredAttack")).toBe(owner);
            const sign = row.fen.split(" ")[1] === "w" ? 1 : -1;
            const motifs = classifyMistakeReviewMotifs({
                fen: row.fen,
                playedMoveUci: row.playedMoveUci,
                bestMoveUci: row.before[0].pvUci[0],
                pvUci: row.before[0].pvUci,
                refutationUci: row.after[0].pvUci,
                cpBefore: row.before[0].cp * sign,
                cpAfter: -row.after[0].cp * sign,
                cpLoss: row.before[0].cp + row.after[0].cp,
            });
            const why = buildMistakeReviewTacticalExplanation(motifs);
            expect(why?.primary).toMatchObject({
                id: "discoveredAttack",
                source: owner ? "missed" : "allowed",
            });
            expect(why?.title).toBe(
                owner ? "What you missed: Discovered Attack" : "Tactic after the move",
            );
        }
    },
);

test.skipIf(!process.env.TACTICAL_DISCOVERY_RECALL_REPORT)(
    "inspect the missed owner-game discovered queen attack",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const sample = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_SAMPLE!, "utf8"));
        const findings = [];
        const probes: { id: string; fen: string; searchMove?: string; minCp?: number }[] = [];
        for (const [ply, root] of [
            [8, "e2e4"],
            [8, "e2e3"],
            [28, "b3b4"],
        ] as const) {
            const row = sample.cases.find(
                (r: any) => r.game === sample.games[0].id && r.ply === ply,
            );
            const steps = replayTacticalLine(row.fen, ply === 8 ? [root, "c4c6", "f1b5"] : [root]);
            expect(steps).toHaveLength(ply === 8 ? 3 : 1);
            const failures: string[] = [],
                leaves: unknown[] = [];
            const proof = proveDiscoveredMaterial(
                steps[0],
                4096,
                100,
                (leaf) => leaves.push(leaf),
                (failure) => failures.push(failure),
            );
            const exchange = proveExchangeDiscovery(
                steps[0],
                8192,
                (failure) => failures.push(failure),
                (leaf) => leaves.push(leaf),
            );
            const trap = proveDiscoveredTrap(steps[0], 4096, (failure) => failures.push(failure));
            expect(trap).not.toBeNull();
            probes.push(
                { id: `${root}:best`, fen: row.fen },
                { id: `${root}:held`, fen: row.fen, searchMove: root, minCp: 100 },
            );
            for (const branch of trap!.branches) {
                const line = replayTacticalLine(makeFen(steps[0].after.toSetup()), [
                    branch.replyUci,
                    branch.answerUci,
                ]);
                probes.push({
                    id: `${root}:${branch.replyUci}`,
                    fen: makeFen(line[0].after.toSetup()),
                    searchMove: branch.answerUci,
                    minCp: 0,
                });
                for (const defence of branch.pinReplies ?? []) {
                    const evasion = replayTacticalLine(makeFen(line[1].after.toSetup()), [
                        defence.replyUci,
                    ])[0];
                    probes.push({
                        id: `${root}:${branch.replyUci}:${defence.replyUci}`,
                        fen: makeFen(evasion.after.toSetup()),
                        searchMove: defence.answerUci,
                        minCp: 0,
                    });
                }
            }
            findings.push({
                ply,
                root,
                fen: row.fen,
                proof,
                exchange,
                trap,
                failures,
                leaves,
                pin: steps[2] ? provePinEntry(steps[2]) : null,
                pinResult: steps[2]
                    ? classifyPositionTacticalMotifs({
                          fen: makeFen(steps[2].before.toSetup()),
                          pvUci: [steps[2].uci],
                      })
                    : null,
                rootResult: classifyPositionTacticalMotifs({ fen: row.fen, pvUci: [root] }),
            });
        }
        writeFileSync(
            privateReportPath(process.env.TACTICAL_DISCOVERY_RECALL_REPORT!),
            JSON.stringify(findings, null, 2),
            { flag: "wx" },
        );
        if (process.env.TACTICAL_DISCOVERY_RECALL_PROBES) {
            for (const control of discoveryTrapCases)
                for (const reflected of [false, true])
                    probes.push({
                        id: `${control.id}:${reflected}`,
                        fen: reflected ? reflectMixedForkFen(control.fen) : control.fen,
                        searchMove: reflected ? reflectMixedForkMove("e2e4") : "e2e4",
                        ...(control.positive ? { minCp: 100 } : {}),
                    });
            writeFileSync(
                privateReportPath(process.env.TACTICAL_DISCOVERY_RECALL_PROBES),
                JSON.stringify({ samplePath: process.env.TACTICAL_RECALL_SAMPLE, probes }, null, 2),
                { flag: "wx" },
            );
        }
    },
);
