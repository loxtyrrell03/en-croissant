import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci } from "chessops/util";
import {
    proveQuietDoubleThreat,
    proveQuietTacticalPreparation,
    proveImmediateFork,
    replayTacticalLine,
} from "../tacticalMotifs/causalTactics";

test.skipIf(
    !process.env.TACTICAL_QUIET_FORK_RECALL ||
        !process.env.TACTICAL_QUIET_FORK_AUDIT,
)(
    "inspect the owner queen-tempo and fork preparation against actual defences",
    async () => {
        const { privateReportPath } =
            await import("../../../scripts/benchmarks/private-pgn-sample.mjs");
        const report = JSON.parse(
            readFileSync(process.env.TACTICAL_QUIET_FORK_RECALL!, "utf8"),
        );
        const row = report.results.find(
            (r: any) => r.game === report.results[0].game && r.ply === 22,
        );
        const steps = replayTacticalLine(row.fen, row.before[0].pvUci);
        expect(steps).toHaveLength(row.before[0].pvUci.length);
        expect(steps[0].uci).toBe("c3b5");
        const root = steps[0],
            failures: string[] = [];
        const doubleThreat = proveQuietDoubleThreat(root, 8192, (reason) =>
            failures.push(reason),
        );
        const preparation = proveQuietTacticalPreparation(steps);
        const hypothetical = root.after.clone();
        hypothetical.turn = root.before.turn;
        hypothetical.epSquare = undefined;
        const threats = [];
        for (const to of hypothetical.dests(root.move.to)) {
            const uci = makeUci({ from: root.move.to, to });
            const step = replayTacticalLine(makeFen(hypothetical.toSetup()), [
                uci,
            ])[0];
            const proof = step && proveImmediateFork(step);
            if (proof) threats.push({ uci, proof });
        }
        const defences = [];
        const probes: any[] = [
            { id: "owner-nb5:root", fen: row.fen },
            { id: "owner-nb5:held", fen: row.fen, searchMove: root.uci },
        ];
        for (const [from, dests] of root.after.allDests())
            for (const to of dests) {
                const move = { from, to },
                    next = root.after.clone();
                expect(
                    root.after.board.get(from)?.role === "pawn" &&
                        (to < 8 || to >= 56),
                ).toBe(false);
                next.play(move);
                defences.push({
                    uci: makeUci(move),
                    san: makeSan(root.after, move),
                    fen: makeFen(next.toSetup()),
                });
                // Audit all legal queen moves, not a selected cooperative reply.
                if (root.after.board.get(from)?.role === "queen")
                    probes.push({
                        id: `owner-nb5:queen-${makeUci(move)}`,
                        fen: makeFen(next.toSetup()),
                    });
            }
        expect(defences.length).toBeGreaterThan(0);
        writeFileSync(
            privateReportPath(process.env.TACTICAL_QUIET_FORK_AUDIT!),
            JSON.stringify(
                {
                    samplePath: process.env.TACTICAL_QUIET_FORK_RECALL,
                    row,
                    doubleThreat,
                    failures,
                    preparation,
                    threats,
                    defences,
                    probes,
                },
                null,
                2,
            ),
            { flag: "wx" },
        );
    },
);
