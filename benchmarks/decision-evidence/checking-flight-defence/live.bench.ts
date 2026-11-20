import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { queries } from "../stockfish-test-harness";
import { classify } from "@/components/panels/tactics/decisionReport.worker";
import { gatherDecisionEvidence } from "@/components/panels/tactics/decisionSearch";
import type { LocalEngine } from "@/utils/engines";
import fixture from "./fixture.json";

test("the actual Stockfish workflow budgets the paired passed-pawn checks", async () => {
    const { input } = fixture;
    const engine = {
        id: "fixture",
        name: "Stockfish 19",
        type: "local",
        version: "19",
        path: process.env.PASSER_FLIGHT_ENGINE!,
        settings: [],
    } satisfies LocalEngine;
    const start = performance.now();
    const controller = new AbortController();
    if (process.env.PASSER_FLIGHT_ABORT === "1") {
        const analysis = gatherDecisionEvidence(engine, input, controller.signal, (phase) => {
            if (phase.startsWith("Checking the passed-pawn defence")) controller.abort();
        });
        await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
        expect(queries.some((item) => item.moves.length === input.history.moves.length + 2)).toBe(
            false,
        );
        return;
    }
    const analysed = await gatherDecisionEvidence(engine, input, controller.signal, () => {});
    const report = classify(analysed, engine.name, input.history);
    const targeted = queries.filter(
        (item) =>
            item.moves.length === input.history.moves.length + 2 && item.moves.at(-1) === "b6b7",
    );
    const baseline = process.env.PASSER_FLIGHT_BASELINE === "1";
    expect(targeted).toHaveLength(baseline ? 0 : 2);
    if (!baseline) {
        expect(targeted.map(({ nodes, restricted }) => [nodes, restricted])).toEqual([
            [500_000, []],
            [500_000, ["d5e3"]],
        ]);
    }
    expect(report?.moves[0].category).toBe(baseline ? "unclear" : "mixed");
    expect(report?.mistake?.category).toBe(baseline ? "unclear" : "tactical");
    writeFileSync(
        process.env.PASSER_FLIGHT_OUTPUT!,
        JSON.stringify(
            {
                milliseconds: performance.now() - start,
                queries: queries.map(({ moves, ...query }) => ({
                    ...query,
                    prefix: moves.slice(input.history.moves.length),
                })),
                move: report?.moves[0].category,
                mistake: report?.mistake?.category,
                evidence: report?.moves[0].passerFlight,
                selectiveFrames: analysed.passerFlight,
            },
            null,
            2,
        ),
        { flag: "wx" },
    );
}, 60_000);
