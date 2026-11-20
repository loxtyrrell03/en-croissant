import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import type { LocalEngine } from "@/utils/engines";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { gatherDecisionEvidence } from "@/components/panels/tactics/decisionSearch";
import fixtures from "./fixtures.json";

test("uses the normal search sequence with a live Stockfish process", async () => {
    const engine = {
        id: "fixture",
        name: "Stockfish 19",
        type: "local",
        version: "19",
        path: process.env.MATE_THREE_ENGINE!,
        settings: [],
    } satisfies LocalEngine;
    const { fen, playedMoveUci, history } = fixtures.copa;
    const start = performance.now();
    const input = await gatherDecisionEvidence(
        engine,
        { fen, playedMoveUci, history },
        new AbortController().signal,
        () => {},
    );
    const report = classify(input, engine.name, history);
    const elapsedMs = performance.now() - start;
    expect(report?.mistake?.mateConsequence?.mateIn).toBe(3);
    const askedPlayedReply = queries.some(
        (row) =>
            row.moves.length === history.moves.length + 1 && row.moves.at(-1) === playedMoveUci,
    );
    expect(askedPlayedReply).toBe(process.env.MATE_THREE_ARM !== "product");
    writeFileSync(
        process.env.MATE_THREE_OUTPUT!,
        JSON.stringify(
            {
                elapsedMs,
                askedPlayedReply,
                queries: queries.map(({ moves, ...row }) => ({
                    ...row,
                    historyPlies: moves.length,
                    last: moves.at(-1),
                })),
                mate: report?.mistake?.mateConsequence,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
}, 90_000);
