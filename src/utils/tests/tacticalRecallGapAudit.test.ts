import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeUci } from "chessops/util";
import { between } from "chessops/attacks";
import {
    proveCheckingPawnRetention,
    proveCheckingMaterialAttack,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";

// Opt-in inspection of an unchanged owner-game input. No owner board is stored
// in the repository, and replacing a nomination is diagnostic, not certification
// that the alternative is optimal or that the whole position is winning.
test.skipIf(
    !process.env.TACTICAL_RECALL_REPLAY || !process.env.TACTICAL_EXCHANGE_NOMINATION_REPORT,
)("inspect legal equal-checker exchanges independently of the nominated PV", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    const output = privateReportPath(process.env.TACTICAL_EXCHANGE_NOMINATION_REPORT!);
    const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
    const row = report.results.find((r: any) => r.game === report.results[0].game && r.ply === 42);
    const root = replayTacticalLine(row.fen, row.before[0].pvUci)[0];
    const checker = root.after.board.get(root.move.to)!;
    const king = root.after.board.kingOf(root.after.turn)!;
    const variants: any[] = [];
    for (const [from, destinations] of root.after.allDests()) {
        if (root.after.board.get(from)?.role !== checker.role) continue;
        for (const to of destinations) {
            if (!between(root.move.to, king).has(to)) continue;
            const next = root.after.clone();
            next.play({ from, to });
            const capture = { from: root.move.to, to };
            if (!next.isLegal(capture)) continue;
            const line = [root.uci, makeUci({ from, to }), makeUci(capture)];
            const steps = replayTacticalLine(row.fen, line);
            expect(steps).toHaveLength(3);
            const trace: string[] = [];
            const proof = proveCheckingPawnRetention(steps, 8192, (message) => trace.push(message));
            variants.push({ line, proof, trace });
        }
    }
    expect(variants.length).toBeGreaterThan(0);
    const probes: any[] = [
        { id: `${row.id}:root-best`, fen: row.fen },
        { id: `${row.id}:root-held`, fen: row.fen, searchMove: root.uci },
    ];
    for (const [from, destinations] of root.after.allDests()) {
        for (const to of destinations) {
            const next = root.after.clone();
            next.play({ from, to });
            probes.push({
                id: `${row.id}:reply-${makeUci({ from, to })}-best`,
                fen: makeFen(next.toSetup()),
            });
        }
    }
    for (const [i, variant] of variants.entries()) {
        const position = replayTacticalLine(row.fen, variant.line.slice(0, 2)).at(-1)!.after;
        probes.push(
            { id: `${row.id}:exchange-${i}-best`, fen: makeFen(position.toSetup()) },
            {
                id: `${row.id}:exchange-${i}-held`,
                fen: makeFen(position.toSetup()),
                searchMove: variant.line[2],
            },
        );
        for (const [j, branch] of (variant.proof?.branches ?? []).entries()) {
            const position = replayTacticalLine(row.fen, [root.uci, branch.replyUci]).at(-1)!.after;
            probes.push({
                id: `${row.id}:variant-${i}-branch-${j}`,
                fen: makeFen(position.toSetup()),
                searchMove: branch.answerUci,
            });
        }
    }
    writeFileSync(
        output,
        JSON.stringify(
            {
                id: row.id,
                fen: row.fen,
                originalLine: row.before[0].pvUci,
                originalProof: proveCheckingPawnRetention(
                    replayTacticalLine(row.fen, row.before[0].pvUci),
                ),
                variants,
                samplePath:
                    process.env.TACTICAL_RECALL_SAMPLE ?? process.env.TACTICAL_RECALL_REPLAY,
                probes,
            },
            null,
            2,
        ) + "\n",
        { flag: "wx" },
    );
});

test.skipIf(!process.env.TACTICAL_RECALL_REPLAY || !process.env.TACTICAL_CHECKING_GAP_REPORT)(
    "inspect the unexplained queen-checking attack in the second owner sample",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const output = privateReportPath(process.env.TACTICAL_CHECKING_GAP_REPORT!);
        const report = JSON.parse(readFileSync(process.env.TACTICAL_RECALL_REPLAY!, "utf8"));
        const games = [...new Set(report.results.map((row: any) => row.game))];
        const row = report.results.find((r: any) => r.game === games[2] && r.ply === 29);
        expect(row.after[0].pvSan[0]).toBe("Qa6+");
        const steps = replayTacticalLine(row.afterFen, row.after[0].pvUci);
        expect(steps).toHaveLength(row.after[0].pvUci.length);
        const root = steps[0];
        const trials = [8192, 16384, 65536].map((limit) => {
            const start = performance.now();
            const proof = proveCheckingMaterialAttack(steps, limit);
            return { limit, proof, elapsedMs: performance.now() - start };
        });
        const probes: any[] = [
            { id: `${row.id}:before-best`, fen: row.fen },
            { id: `${row.id}:before-played`, fen: row.fen, searchMove: row.playedMoveUci },
            { id: `${row.id}:after-best`, fen: row.afterFen },
            { id: `${row.id}:after-held`, fen: row.afterFen, searchMove: root.uci },
        ];
        for (const [from, destinations] of root.after.allDests()) {
            for (const to of destinations) {
                const reply = { from, to };
                const next = root.after.clone();
                next.play(reply);
                probes.push({
                    id: `${row.id}:reply-${makeUci(reply)}`,
                    fen: makeFen(next.toSetup()),
                });
            }
        }
        // The apparent rook payoff offers the queen to the king. Inspect that
        // accepting defence too, rather than counting the declining PV as proof.
        const offer = steps.find(
            (step, index) =>
                index >= 4 &&
                step.capture === 500 &&
                step.before.board.get(step.move.from)?.role === "queen",
        );
        expect(offer).toBeTruthy();
        probes.push({
            id: `${row.id}:queen-offer`,
            fen: makeFen(offer!.before.toSetup()),
            searchMove: offer!.uci,
        });
        for (const [from, destinations] of offer!.after.allDests()) {
            if (!destinations.has(offer!.move.to)) continue;
            const accepted = offer!.after.clone();
            accepted.play({ from, to: offer!.move.to });
            probes.push({
                id: `${row.id}:accepted-${makeUci({ from, to: offer!.move.to })}`,
                fen: makeFen(accepted.toSetup()),
            });
        }
        writeFileSync(
            output,
            JSON.stringify(
                {
                    id: row.id,
                    fen: row.afterFen,
                    line: row.after[0].pvUci,
                    trials,
                    samplePath: process.env.TACTICAL_RECALL_REPLAY,
                    probes,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
    },
);

test("owner gap audit reports cannot be written into this checkout", async () => {
    const { privateReportPath } =
        await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
    expect(() => privateReportPath(`${process.cwd()}/owner-gap-report.json`)).toThrow(
        "Private benchmark reports must stay outside the checkout",
    );
});
