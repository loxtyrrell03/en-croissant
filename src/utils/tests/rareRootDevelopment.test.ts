import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import type { NormalMove } from "chessops/types";
import { classifyPositionTacticalMotifs } from "../tacticalMotifs/mistakeReviewAdapter";
import {
    replayTacticalLine,
    tacticalExchangeGain,
    proveQuietMatingAttack,
} from "../tacticalMotifs/causalTactics";

test("inspect unresolved rare root mechanisms without importing a later theme", () => {
    const sample = JSON.parse(
        readFileSync("benchmarks/tactical-relevance/rare-theme-development.json", "utf8"),
    ) as { cases: { id: string; startFen: string; bestLine: string[] }[] };
    const rows = sample.cases.filter((row) =>
        ["lichess:ZVq1J", "lichess:snAK4", "lichess:4Ds65"].includes(row.id),
    );
    expect(rows).toHaveLength(3);
    const report = rows.map((row) => {
        const replay = replayTacticalLine(row.startFen, row.bestLine);
        expect(replay).toHaveLength(row.bestLine.length);
        const first = replay[0];
        const defences = [...first.after.allDests()].flatMap(([from, destinations]) =>
            [...destinations].map((to) => {
                const move = { from, to };
                const san = makeSan(first.after, move);
                const pos = first.after.clone();
                pos.play(move);
                const follow = parseUci("e5d7") as NormalMove;
                return {
                    uci: makeUci(move),
                    san,
                    fen: makeFen(pos.toSetup()),
                    ...(row.id === "lichess:ZVq1J"
                        ? {
                              knightCaptureLegal: pos.isLegal(follow),
                              knightCaptureGain: pos.isLegal(follow)
                                  ? tacticalExchangeGain(pos, follow)
                                  : null,
                          }
                        : {}),
                };
            }),
        );
        const reached = replay.map((step, index) => ({
            ply: index + 1,
            fen: makeFen(step.before.toSetup()),
            result: classifyPositionTacticalMotifs({
                fen: makeFen(step.before.toSetup()),
                pvUci: row.bestLine.slice(index),
            }),
        }));
        const matingFailures: string[] = [];
        const mating = proveQuietMatingAttack(first, 8192, (reason) => matingFailures.push(reason));
        return {
            id: row.id,
            fen: row.startFen,
            source: replay.map((step) => step.san),
            rootInCheck: first.before.isCheck(),
            root: classifyPositionTacticalMotifs({
                fen: row.startFen,
                pvUci: row.bestLine.slice(0, 1),
            }),
            result: classifyPositionTacticalMotifs({ fen: row.startFen, pvUci: row.bestLine }),
            defences,
            reached,
            mating,
            matingFailures,
        };
    });
    const pinned = report.find((row) => row.id === "lichess:ZVq1J")!;
    expect(pinned.rootInCheck).toBe(true);
    expect(pinned.defences.map((row) => row.san).sort()).toEqual(["Ke4", "Kf4", "Qxe5+"].sort());
    expect(pinned.defences.every((row) => row.knightCaptureLegal === false)).toBe(true);
    expect(pinned.result.motifs.some((m) => m.id === "fork" && m.ply === 1)).toBe(false);
    expect(pinned.result.timeline).toContainEqual(
        expect.objectContaining({ id: "discoveredCheck", ply: 5 }),
    );
    const trap = report.find((row) => row.id === "lichess:snAK4")!;
    expect(trap.defences.some((row) => row.san === "Rxe7+")).toBe(true);
    expect(trap.reached[2].result.motifs[0]).toMatchObject({ id: "trappedPiece", ply: 1 });
    if (process.env.TACTICAL_RARE_ROOT_REPORT)
        writeFileSync(
            process.env.TACTICAL_RARE_ROOT_REPORT,
            JSON.stringify(
                {
                    scope: "Unresolved public root diagnostics; no expected theme or correctness inferred from an empty result.",
                    cases: report,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
});
