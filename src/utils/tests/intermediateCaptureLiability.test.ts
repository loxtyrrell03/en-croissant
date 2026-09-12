import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    intermediateCaptureProof,
    proveDiscoveredMaterial,
    replayTacticalLine,
    tacticalExchangeGain,
} from "../tacticalMotifs/causalTactics";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";

test("a checking discovery subsumes its own captured rook, not another ply's capture", () => {
    const fen = "k7/3q3p/1r6/8/N7/8/8/R5K1 w - - 0 1";
    const result = classifyPositionTacticalMotifs({ fen, pvUci: ["a4b6", "a8b8", "b6d7"] });
    expect(result.motifs.find((m) => m.id === "doubleCheck")).toMatchObject({ ply: 1 });
    expect(result.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
    expect(result.timeline?.find((m) => m.id === "hangingPiece" && m.ply === 3)).toBeDefined();
    const mirrored = "r5k1/8/8/n7/8/1R6/3Q3P/K7 b - - 0 1";
    const reflected = classifyPositionTacticalMotifs({
        fen: mirrored,
        pvUci: ["a5b3", "a1b1", "b3d2"],
    });
    expect(reflected.motifs.some((m) => m.id === "doubleCheck")).toBe(true);
    expect(reflected.timeline?.some((m) => m.id === "hangingPiece" && m.ply === 1)).toBe(false);
});

test.skipIf(!process.env.TACTICAL_INTERMEDIATE_PRIVATE_INPUT)(
    "audit changed private intermediate captures against off-square losses",
    async () => {
        const prior = JSON.parse(
            readFileSync(process.env.TACTICAL_INTERMEDIATE_PRIVATE_INPUT!, "utf8"),
        );
        const rows = prior.results.flatMap((group: any) => group.cases);
        const probes: any[] = [];
        const observations: any[] = [];
        const add = (id: string, pos: any, searchMove?: string) => {
            const fen = makeFen(pos.toSetup());
            if (!probes.some((p) => p.fen === fen && p.searchMove === searchMove))
                probes.push({ id, fen, searchMove });
        };
        for (const [id, ply, deferredSan] of [
            ["105", 5, "Qxa2"],
            ["164", 2, "Rxd2"],
            ["32", 3, "axb4"],
            ["133", 17, "Qxe4"],
        ] as const) {
            const row = rows.find((r: any) => r.id === `private-easy:${id}`);
            const moves = id === "105" ? row.sourceUci : row.scan.variations[0].lineUci;
            const step = replayTacticalLine(row.fen, moves)[ply - 1];
            const proof = intermediateCaptureProof(step);
            expect(proof?.gain ?? null).toBe(id === "133" ? 550 : null);
            add(`${id}:root`, step.before, step.uci);
            const branches: any[] = [];
            for (const [from, dests] of step.after.allDests())
                for (const to of dests) {
                    const reply = { from, to },
                        next = step.after.clone();
                    next.play(reply);
                    const deferred = parseSan(next, deferredSan);
                    expect(deferred).toBeDefined();
                    const replySan = makeSan(step.after, reply);
                    add(`${id}:${replySan}:deferred`, next, makeUci(deferred!));
                    const leaf = next.clone();
                    leaf.play(deferred!);
                    const losses: any[] = [];
                    for (const [a, ds] of leaf.allDests())
                        for (const b of ds) {
                            if (!leaf.board.get(b)) continue;
                            const capture = { from: a, to: b },
                                gain = tacticalExchangeGain(leaf, capture);
                            if (gain > 0) losses.push({ san: makeSan(leaf, capture), gain });
                        }
                    branches.push({
                        reply: replySan,
                        deferredSan,
                        fen: makeFen(leaf.toSetup()),
                        losses,
                    });
                }
            const leaves: any[] = [];
            const discovery =
                id === "105"
                    ? proveDiscoveredMaterial(step, 4096, 501, (leaf) => leaves.push(leaf))
                    : null;
            expect(discovery).toBe(id === "105" ? 600 : null);
            if (id === "105") {
                for (const [i, leaf] of leaves.entries()) {
                    if (leaf.fen && leaf.moveUci)
                        probes.push({
                            id: `${id}:discovery:${i}`,
                            fen: leaf.fen,
                            searchMove: leaf.moveUci,
                        });
                }
            }
            observations.push({
                id,
                proof,
                branches,
                discovery,
                leaves,
                result: classifyPositionTacticalMotifs({
                    fen: makeFen(step.before.toSetup()),
                    pvUci: [step.uci],
                }),
            });
        }
        if (process.env.TACTICAL_INTERMEDIATE_PRIVATE_PROBES) {
            const { privateReportPath } =
                await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
            const output = privateReportPath(process.env.TACTICAL_INTERMEDIATE_PRIVATE_PROBES!);
            writeFileSync(
                output,
                JSON.stringify(
                    { samplePath: process.env.TACTICAL_PRIVATE_THIRD_SAMPLE, probes, observations },
                    null,
                    2,
                ),
                { flag: "wx" },
            );
        }
    },
);
